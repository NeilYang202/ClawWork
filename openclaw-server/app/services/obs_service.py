import base64
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import logging

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_signed_payload_token, decode_signed_payload_token
from app.db.models import ObsUploadRecord, User
from app.schemas.obs import ObsUploadIn, ObsUploadOut, UploadedFileRef, ObsUploadRecordOut, ObsFileEventOut
from app.services.cache import stream_add, stream_read
from app.services.config_service import get_admin_config
from app.services.workspace_sync import mirror_uploaded_object_to_workspace

FILE_EVENT_STREAM = 'obs:file-events'
logger = logging.getLogger(__name__)


def _sanitize_name(name: str) -> str:
    return ''.join(ch for ch in name if ch.isalnum() or ch in ('-', '_', '.', '/')).strip('/') or 'file.bin'


MIME_EXT_MAP: dict[str, str] = {
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
}


def _ensure_extension(file_name: str, mime_type: str) -> str:
    ext = Path(file_name).suffix
    if ext:
        return file_name
    mapped_ext = MIME_EXT_MAP.get((mime_type or '').lower())
    if not mapped_ext:
        return file_name
    return f'{file_name}{mapped_ext}'


def _build_s3_client(obs_endpoint: str, obs_access_key: str, obs_secret_key: str, obs_region: str | None):
    return boto3.client(
        's3',
        endpoint_url=obs_endpoint,
        aws_access_key_id=obs_access_key,
        aws_secret_access_key=obs_secret_key,
        region_name=obs_region or 'us-east-1',
        verify=settings.obs_verify_ssl,
        config=BotoConfig(signature_version='s3v4'),
    )


def _build_prefix(user: User, payload_gateway_id: str, payload_session_key: str, payload_task_id: str | None, base_path: str | None) -> str:
    safe_user = _sanitize_name(user.username).replace('/', '_')
    prefix_parts = [base_path or 'desktop', safe_user, payload_gateway_id, payload_session_key]
    if payload_task_id:
        prefix_parts.append(payload_task_id)
    prefix_parts.append(datetime.now(timezone.utc).strftime('%Y%m%d'))
    return '/'.join(prefix_parts)


def _build_download_url(base_url: str, username: str, bucket: str, object_key: str, file_name: str) -> str:
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
    return f"{base_url.rstrip('/')}/api/obs/download?token={quote(token, safe='')}"


def parse_download_token(token: str) -> dict | None:
    payload = decode_signed_payload_token(token)
    if not payload:
        return None
    if payload.get('type') != 'obs_download':
        return None
    bucket = payload.get('b')
    object_key = payload.get('k')
    file_name = payload.get('f')
    if not isinstance(bucket, str) or not isinstance(object_key, str) or not isinstance(file_name, str):
        return None
    username = payload.get('u')
    if username is not None and not isinstance(username, str):
        return None
    return {'bucket': bucket, 'object_key': object_key, 'file_name': file_name, 'username': username}


async def upload_to_obs(db: AsyncSession, payload: ObsUploadIn, user: User, base_url: str) -> ObsUploadOut:
    cfg = await get_admin_config(db)
    obs = cfg.obs
    if not obs.enabled:
        return ObsUploadOut(files=[])

    if not obs.endpoint or not obs.bucket or not obs.accessKey or not obs.secretKey:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='OBS is not fully configured')

    s3 = _build_s3_client(obs.endpoint, obs.accessKey, obs.secretKey, obs.region)
    base_prefix = _build_prefix(user, payload.gatewayId, payload.sessionKey, payload.taskId, obs.basePath)

    uploaded: list[UploadedFileRef] = []
    pending_events: list[dict[str, str]] = []
    for item in payload.files:
        file_name = _ensure_extension(_sanitize_name(item.fileName), item.mimeType)
        object_key = f'{base_prefix}/{file_name}'
        try:
            content = base64.b64decode(item.content, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f'invalid base64 content: {item.fileName}') from exc
        try:
            s3.put_object(Bucket=obs.bucket, Key=object_key, Body=content, ContentType=item.mimeType)
        except (ClientError, BotoCoreError) as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f'OBS put_object failed: {exc}') from exc
        openclaw_path = f'obs://{obs.bucket}/{object_key}'
        file_url = _build_download_url(base_url, user.username, obs.bucket, object_key, file_name)
        uploaded.append(
            UploadedFileRef(
                fileName=file_name,
                objectKey=object_key,
                url=file_url,
                openclawPath=openclaw_path,
            )
        )
        record = ObsUploadRecord(
            user_id=user.id,
            username=user.username,
            gateway_id=payload.gatewayId,
            session_key=payload.sessionKey,
            task_id=payload.taskId,
            file_name=file_name,
            mime_type=item.mimeType,
            byte_size=len(content),
            obs_bucket=obs.bucket,
            object_key=object_key,
            file_url=file_url,
            openclaw_path=openclaw_path,
            content_sha256=hashlib.sha256(content).hexdigest(),
            source_kind='client_upload',
            source_path=f'{payload.sessionKey}:{payload.taskId or ""}:{file_name}',
        )
        db.add(record)
        await db.flush()
        await mirror_uploaded_object_to_workspace(
            db=db,
            user=user,
            task_id=payload.taskId,
            file_name=file_name,
            bucket=obs.bucket,
            object_key=object_key,
            s3_client=s3,
        )
        pending_events.append(
            {
                'type': 'file_uploaded',
                'record_id': str(record.id),
                'user_id': user.id,
                'username': user.username.strip().lower(),
                'gateway_id': payload.gatewayId,
                'session_key': payload.sessionKey,
                'task_id': payload.taskId or '',
                'file_name': file_name,
                'mime_type': item.mimeType or '',
                'byte_size': str(len(content)),
                'object_key': object_key,
                'url': file_url,
                'created_at': datetime.now(timezone.utc).isoformat(),
            }
        )

    await db.commit()
    for event in pending_events:
        await stream_add(FILE_EVENT_STREAM, event)
    return ObsUploadOut(files=uploaded)


async def list_user_upload_records(
    db: AsyncSession,
    user: User,
    base_url: str,
    session_key: str,
    task_id: str | None = None,
    limit: int = 200,
) -> list[ObsUploadRecordOut]:
    stmt = select(ObsUploadRecord).where(ObsUploadRecord.session_key == session_key)
    if task_id:
        stmt = stmt.where(ObsUploadRecord.task_id == task_id)
    if not user.is_admin:
        stmt = stmt.where(ObsUploadRecord.username == user.username)
    stmt = stmt.order_by(ObsUploadRecord.created_at.desc()).limit(max(1, min(limit, 1000)))
    rows = (await db.execute(stmt)).scalars().all()
    return [
        ObsUploadRecordOut(
            id=row.id,
            username=row.username,
            gatewayId=row.gateway_id,
            sessionKey=row.session_key,
            taskId=row.task_id,
            fileName=row.file_name,
            mimeType=row.mime_type,
            byteSize=row.byte_size,
            objectKey=row.object_key,
            url=_build_download_url(base_url, row.username, row.obs_bucket, row.object_key, row.file_name),
            openclawPath=row.openclaw_path,
            createdAt=row.created_at.isoformat(),
        )
        for row in rows
    ]


async def list_user_file_events(
    db: AsyncSession,
    user: User,
    cursor: str = '$',
    limit: int = 100,
) -> tuple[str, list[ObsFileEventOut]]:
    rows = await stream_read(FILE_EVENT_STREAM, cursor=cursor, count=limit)
    if not rows:
        return await _list_user_file_events_from_db(db=db, user=user, cursor=cursor, limit=limit)

    next_cursor = rows[-1][0]
    items: list[ObsFileEventOut] = []
    target_user = user.username.strip().lower()
    for event_id, payload in rows:
        if payload.get('type') != 'file_uploaded':
            continue
        if payload.get('username', '').strip().lower() != target_user:
            continue
        byte_size = 0
        try:
            byte_size = int(payload.get('byte_size', '0') or '0')
        except ValueError:
            byte_size = 0
        items.append(
            ObsFileEventOut(
                eventId=event_id,
                taskId=payload.get('task_id') or None,
                sessionKey=payload.get('session_key', ''),
                gatewayId=payload.get('gateway_id', ''),
                fileName=payload.get('file_name', ''),
                mimeType=payload.get('mime_type') or None,
                byteSize=byte_size,
                objectKey=payload.get('object_key', ''),
                url=payload.get('url', ''),
                createdAt=payload.get('created_at', datetime.now(timezone.utc).isoformat()),
            )
        )
    if items:
        return next_cursor, items

    return await _list_user_file_events_from_db(db=db, user=user, cursor=cursor, limit=limit)


def _decode_db_cursor(cursor: str) -> int | None:
    token = (cursor or '').strip()
    if not token:
        return None
    if token.startswith('db:'):
        token = token[3:]
    if not token.isdigit():
        return None
    try:
        return int(token)
    except Exception:
        return None


async def _list_user_file_events_from_db(
    db: AsyncSession,
    user: User,
    cursor: str,
    limit: int,
) -> tuple[str, list[ObsFileEventOut]]:
    safe_limit = max(1, min(limit, 500))
    target_user = user.username.strip().lower()
    source_kinds = ('workspace_sync', 'client_upload')

    if cursor == '$':
        max_id_stmt = select(func.max(ObsUploadRecord.id)).where(
            ObsUploadRecord.username == target_user,
            ObsUploadRecord.source_kind.in_(source_kinds),
        )
        max_id = (await db.execute(max_id_stmt)).scalar_one_or_none() or 0
        return f'db:{int(max_id)}', []

    last_id = _decode_db_cursor(cursor)
    if last_id is None:
        logger.warning('invalid file-events cursor: %s', cursor)
        return cursor, []

    stmt = (
        select(ObsUploadRecord)
        .where(
            ObsUploadRecord.username == target_user,
            ObsUploadRecord.id > last_id,
            ObsUploadRecord.source_kind.in_(source_kinds),
        )
        .order_by(ObsUploadRecord.id.asc())
        .limit(safe_limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return f'db:{last_id}', []

    items: list[ObsFileEventOut] = []
    for row in rows:
        items.append(
            ObsFileEventOut(
                eventId=f'db:{row.id}',
                taskId=row.task_id,
                sessionKey=row.session_key,
                gatewayId=row.gateway_id,
                fileName=row.file_name,
                mimeType=row.mime_type,
                byteSize=int(row.byte_size or 0),
                objectKey=row.object_key,
                url=row.file_url or '',
                createdAt=row.created_at.isoformat(),
            )
        )
    return f'db:{rows[-1].id}', items
