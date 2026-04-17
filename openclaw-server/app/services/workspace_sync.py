import asyncio
import hashlib
import mimetypes
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_signed_payload_token
from app.db.models import AppConfig, ObsUploadRecord, User, UserAgentBinding
from app.db.session import SessionLocal
from app.services.cache import stream_add

FILE_EVENT_STREAM = 'obs:file-events'
logger = logging.getLogger(__name__)
SKIP_DIR_NAMES = {
    '.git',
    '.svn',
    '.hg',
    '.idea',
    '.vscode',
    '.cache',
    '.obs-sync',
    '__pycache__',
    'node_modules',
    'temp',
    'tmp',
    'inbox',
    'inputs',
    'logs',
    'log',
}
SKIP_SUFFIXES = {
    '.tmp',
    '.temp',
    '.part',
    '.partial',
    '.swp',
    '.swo',
    '.crdownload',
    '.download',
    '.lock',
    '.lck',
}
SKIP_PREFIXES = ('.', '~$')
SKIP_FILE_NAMES = {
    'agents.md',
    'bootstrap.md',
    'heartbeat.md',
    'identity.md',
    'soul.md',
    'tools.md',
    'user.md',
}


@dataclass
class _ObsRuntime:
    enabled: bool
    endpoint: str | None
    bucket: str | None
    base_path: str | None
    access_key: str | None
    secret_key: str | None
    region: str | None


def _sanitize_name(name: str) -> str:
    return ''.join(ch for ch in name if ch.isalnum() or ch in ('-', '_', '.', '/')).strip('/') or 'file.bin'


def _build_s3_client(obs: _ObsRuntime):
    return boto3.client(
        's3',
        endpoint_url=obs.endpoint,
        aws_access_key_id=obs.access_key,
        aws_secret_access_key=obs.secret_key,
        region_name=obs.region or 'us-east-1',
        verify=settings.obs_verify_ssl,
        config=BotoConfig(signature_version='s3v4'),
    )


def _build_download_url(username: str, bucket: str, object_key: str, file_name: str) -> str:
    token = create_signed_payload_token(
        {
            'type': 'obs_download',
            'u': username.strip().lower(),
            'b': bucket,
            'k': object_key,
            'f': file_name,
        },
        expires_seconds=60 * 30,
    )
    return f'/api/obs/download?token={token}'


def _resolve_case_insensitive_under_root(path: Path, root: Path) -> Path | None:
    raw_parts = path.parts
    root_parts = root.parts
    if len(raw_parts) < len(root_parts):
        return None
    if [p.casefold() for p in raw_parts[: len(root_parts)]] != [p.casefold() for p in root_parts]:
        return None

    current = root
    for seg in raw_parts[len(root_parts) :]:
        if seg in ('', '.', '..'):
            return None
        try:
            matched = next((item for item in current.iterdir() if item.name.casefold() == seg.casefold()), None)
        except Exception:
            return None
        if matched is None:
            return None
        current = matched
    return current


def normalize_workspace_path(path: str | None) -> Path | None:
    if not path:
        return None
    ws = Path(path).expanduser()
    if not ws.is_absolute():
        return None
    root = Path(settings.workspace_root).expanduser()
    try:
        root = root.resolve(strict=True)
    except Exception:
        return None

    try:
        resolved = ws.resolve(strict=True)
    except Exception:
        resolved = _resolve_case_insensitive_under_root(ws, root)
        if resolved is None:
            return None
    try:
        resolved = resolved.resolve(strict=True)
    except Exception:
        return None
    if not resolved.is_dir():
        return None
    if resolved != root and root not in resolved.parents:
        return None
    return resolved


async def _get_binding_for_user(db: AsyncSession, username: str) -> UserAgentBinding | None:
    stmt = select(UserAgentBinding).where(UserAgentBinding.username == username.strip().lower())
    return (await db.execute(stmt)).scalars().first()


async def mirror_uploaded_object_to_workspace(
    db: AsyncSession,
    user: User,
    task_id: str | None,
    file_name: str,
    bucket: str,
    object_key: str,
    s3_client,
) -> str | None:
    binding = await _get_binding_for_user(db, user.username)
    workspace = normalize_workspace_path(binding.workspace_path if binding else None)
    if workspace is None:
        return None

    safe_name = _sanitize_name(file_name).replace('/', '_')
    resolved_task_id = (task_id or '').strip() or 'unknown-task'
    target_dir = workspace / 'temp' / resolved_task_id / 'inputs'
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    try:
        result = s3_client.get_object(Bucket=bucket, Key=object_key)
        body = result['Body'].read()
    except (ClientError, BotoCoreError):
        return None

    target_path.write_bytes(body)
    return str(target_path)


async def _load_runtime(db: AsyncSession) -> tuple[_ObsRuntime, list[UserAgentBinding]]:
    cfg = (await db.execute(select(AppConfig).where(AppConfig.id == 1))).scalar_one_or_none()
    if cfg is None:
        return _ObsRuntime(False, None, None, None, None, None, None), []
    bindings = (await db.execute(select(UserAgentBinding))).scalars().all()
    return (
        _ObsRuntime(
            enabled=cfg.obs_enabled,
            endpoint=cfg.obs_endpoint,
            bucket=cfg.obs_bucket,
            base_path=cfg.obs_base_path,
            access_key=cfg.obs_access_key,
            secret_key=cfg.obs_secret_key,
            region=cfg.obs_region,
        ),
        bindings,
    )


def _infer_task_id(workspace: Path, file_path: Path) -> str | None:
    try:
        rel = file_path.resolve().relative_to(workspace.resolve())
    except Exception:
        return None
    parts = rel.parts
    if len(parts) >= 3 and parts[0] == 'files':
        return parts[1]
    return None


def _should_sync_file(workspace: Path, file_path: Path) -> bool:
    try:
        rel = file_path.resolve().relative_to(workspace.resolve())
    except Exception:
        return False
    parts = rel.parts
    if not parts:
        return False
    for part in parts[:-1]:
        p = part.strip().lower()
        if not p:
            continue
        if p in SKIP_DIR_NAMES:
            return False
    name = parts[-1]
    if not name:
        return False
    lower_name = name.lower()
    if lower_name in SKIP_FILE_NAMES:
        return False
    for prefix in SKIP_PREFIXES:
        if lower_name.startswith(prefix):
            return False
    for suffix in SKIP_SUFFIXES:
        if lower_name.endswith(suffix):
            return False
    return True


async def _resolve_routing(db: AsyncSession, username: str, binding: UserAgentBinding, task_id: str | None) -> tuple[str, str]:
    if task_id:
        stmt = (
            select(ObsUploadRecord)
            .where(ObsUploadRecord.username == username, ObsUploadRecord.task_id == task_id)
            .order_by(ObsUploadRecord.created_at.desc())
            .limit(1)
        )
        row = (await db.execute(stmt)).scalars().first()
        if row is not None:
            return row.gateway_id, row.session_key
    synthetic_session = f'workspace-sync:{binding.agent_id}'
    return binding.gateway_id, synthetic_session


def _compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _source_path_for_dedup(workspace: Path, file_path: Path) -> str:
    try:
        return str(file_path.resolve().relative_to(workspace.resolve()).as_posix())
    except Exception:
        return str(file_path.name)


async def _already_uploaded_same_content(
    db: AsyncSession,
    username: str,
    source_path: str,
    content_sha256: str,
) -> bool:
    stmt = (
        select(ObsUploadRecord.id)
        .where(
            ObsUploadRecord.username == username,
            ObsUploadRecord.source_kind == 'workspace_sync',
            ObsUploadRecord.source_path == source_path,
            ObsUploadRecord.content_sha256 == content_sha256,
        )
        .order_by(ObsUploadRecord.created_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).first()
    return row is not None


async def _cleanup_old_records_if_due(db: AsyncSession) -> None:
    global _last_cleanup_at
    now = datetime.now(timezone.utc)
    if _last_cleanup_at and (now - _last_cleanup_at).total_seconds() < max(60, settings.obs_record_cleanup_interval_seconds):
        return
    retention_days = max(1, settings.obs_record_retention_days)
    cutoff = now - timedelta(days=retention_days)
    await db.execute(delete(ObsUploadRecord).where(ObsUploadRecord.created_at < cutoff))
    await db.commit()
    _last_cleanup_at = now


_state: dict[str, tuple[int, int, str]] = {}
_sync_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None
_warmup_done = False
_last_cleanup_at: datetime | None = None


async def _upload_workspace_file(
    db: AsyncSession,
    obs: _ObsRuntime,
    binding: UserAgentBinding,
    file_path: Path,
    allow_upload: bool,
) -> None:
    workspace = normalize_workspace_path(binding.workspace_path)
    if workspace is None:
        return

    stat = file_path.stat()
    if stat.st_size <= 0 or stat.st_size > settings.workspace_upload_max_bytes:
        return

    now_ts = datetime.now(timezone.utc).timestamp()
    # debounce: skip hot files still being written
    if now_ts - stat.st_mtime < 2:
        return

    key_state = str(file_path)
    signature = (int(stat.st_mtime_ns), int(stat.st_size))
    old = _state.get(key_state)
    if old and old[0] == signature[0] and old[1] == signature[1]:
        return

    digest = _compute_sha256(file_path)
    if old and old[2] == digest:
        _state[key_state] = (signature[0], signature[1], digest)
        return
    if not allow_upload:
        _state[key_state] = (signature[0], signature[1], digest)
        return

    if not (obs.enabled and obs.endpoint and obs.bucket and obs.access_key and obs.secret_key):
        return

    source_path = _source_path_for_dedup(workspace, file_path)
    if await _already_uploaded_same_content(db, binding.username, source_path, digest):
        _state[key_state] = (signature[0], signature[1], digest)
        return

    task_id = _infer_task_id(workspace, file_path)
    gateway_id, session_key = await _resolve_routing(db, binding.username, binding, task_id)

    safe_user = _sanitize_name(binding.username).replace('/', '_')
    safe_file = _sanitize_name(file_path.name).replace('/', '_')
    date_part = datetime.now(timezone.utc).strftime('%Y%m%d')
    object_key = '/'.join(
        [
            obs.base_path or 'desktop',
            safe_user,
            gateway_id,
            session_key,
            task_id or 'workspace',
            date_part,
            safe_file,
        ]
    )

    s3 = _build_s3_client(obs)
    content_type = mimetypes.guess_type(safe_file)[0] or 'application/octet-stream'
    try:
        s3.upload_file(str(file_path), obs.bucket, object_key, ExtraArgs={'ContentType': content_type})
    except (ClientError, BotoCoreError):
        return

    file_url = _build_download_url(binding.username, obs.bucket, object_key, safe_file)
    record = ObsUploadRecord(
        user_id=None,
        username=binding.username,
        gateway_id=gateway_id,
        session_key=session_key,
        task_id=task_id,
        file_name=safe_file,
        mime_type=content_type,
        byte_size=int(stat.st_size),
        obs_bucket=obs.bucket,
        object_key=object_key,
        file_url=file_url,
        openclaw_path=f'obs://{obs.bucket}/{object_key}',
        content_sha256=digest,
        source_kind='workspace_sync',
        source_path=source_path,
    )
    db.add(record)
    await db.flush()
    await db.commit()
    _state[key_state] = (signature[0], signature[1], digest)

    await stream_add(
        FILE_EVENT_STREAM,
        {
            'type': 'file_uploaded',
            'record_id': str(record.id),
            'user_id': '',
            'username': binding.username.strip().lower(),
            'gateway_id': gateway_id,
            'session_key': session_key,
            'task_id': task_id or '',
            'file_name': safe_file,
            'mime_type': content_type,
            'byte_size': str(int(stat.st_size)),
            'object_key': object_key,
            'url': file_url,
            'created_at': datetime.now(timezone.utc).isoformat(),
        },
    )


async def _scan_once() -> None:
    global _warmup_done
    allow_upload = _warmup_done
    async with SessionLocal() as db:
        await _cleanup_old_records_if_due(db)
        obs, bindings = await _load_runtime(db)
        if not bindings:
            return
        for binding in bindings:
            workspace = normalize_workspace_path(binding.workspace_path)
            if workspace is None:
                continue
            if not workspace.exists() or not workspace.is_dir():
                continue
            for path in workspace.rglob('*'):
                if not path.is_file():
                    continue
                if not _should_sync_file(workspace, path):
                    continue
                try:
                    await _upload_workspace_file(db, obs, binding, path, allow_upload=allow_upload)
                except Exception as exc:
                    logger.warning('workspace_sync upload failed: user=%s path=%s err=%s', binding.username, path, exc)
                    continue
    _warmup_done = True


async def _worker_loop() -> None:
    assert _stop_event is not None
    while not _stop_event.is_set():
        try:
            if settings.workspace_sync_enabled:
                await _scan_once()
        except Exception as exc:
            logger.warning('workspace_sync scan failed: %s', exc)
        try:
            await asyncio.wait_for(_stop_event.wait(), timeout=max(2, settings.workspace_scan_interval_seconds))
        except asyncio.TimeoutError:
            pass


def start_workspace_sync_worker() -> None:
    global _sync_task, _stop_event
    if _sync_task is not None and not _sync_task.done():
        return
    global _warmup_done
    _warmup_done = False
    _stop_event = asyncio.Event()
    _sync_task = asyncio.create_task(_worker_loop())


async def stop_workspace_sync_worker() -> None:
    global _sync_task, _stop_event, _last_cleanup_at
    if _stop_event is not None:
        _stop_event.set()
    if _sync_task is not None:
        try:
            await _sync_task
        except Exception:
            pass
    _sync_task = None
    _stop_event = None
    _last_cleanup_at = None
    _state.clear()
