import base64
from datetime import datetime, timezone
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import ObsUploadRecord, User
from app.schemas.obs import ObsUploadIn, ObsUploadOut, UploadedFileRef, ObsUploadRecordOut
from app.services.config_service import get_admin_config


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


async def upload_to_obs(db: AsyncSession, payload: ObsUploadIn, user: User) -> ObsUploadOut:
    cfg = await get_admin_config(db)
    obs = cfg.obs
    if not obs.enabled:
        return ObsUploadOut(files=[])

    if not obs.endpoint or not obs.bucket or not obs.accessKey or not obs.secretKey:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='OBS is not fully configured')

    s3 = _build_s3_client(obs.endpoint, obs.accessKey, obs.secretKey, obs.region)
    base_prefix = _build_prefix(user, payload.gatewayId, payload.sessionKey, payload.taskId, obs.basePath)

    uploaded: list[UploadedFileRef] = []
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
        file_url = f"{obs.endpoint.rstrip('/')}/{obs.bucket}/{object_key}"
        uploaded.append(
            UploadedFileRef(
                fileName=file_name,
                objectKey=object_key,
                url=file_url,
                openclawPath=openclaw_path,
            )
        )
        db.add(
            ObsUploadRecord(
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
            )
        )

    await db.commit()
    return ObsUploadOut(files=uploaded)


async def list_user_upload_records(
    db: AsyncSession,
    user: User,
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
            url=row.file_url,
            openclawPath=row.openclaw_path,
            createdAt=row.created_at.isoformat(),
        )
        for row in rows
    ]
