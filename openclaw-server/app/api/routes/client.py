from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.config import PublicClientConfig, RuntimeClientConfig
from app.schemas.obs import ObsUploadRecordOut, ObsFileEventListOut
from app.services.config_service import get_public_config, get_runtime_config
from app.services.obs_service import list_user_upload_records, list_user_file_events

router = APIRouter(prefix='/api/client', tags=['client'])


@router.get('/public-config', response_model=PublicClientConfig)
async def public_config(db: AsyncSession = Depends(get_db)) -> PublicClientConfig:
    return await get_public_config(db)


@router.get('/runtime-config', response_model=RuntimeClientConfig)
async def runtime_config(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RuntimeClientConfig:
    return await get_runtime_config(db)


@router.get('/session-files', response_model=list[ObsUploadRecordOut])
async def session_files(
    sessionKey: str,
    request: Request,
    taskId: str | None = None,
    limit: int = 200,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ObsUploadRecordOut]:
    base_url = str(request.base_url).rstrip('/')
    return await list_user_upload_records(db, user=user, base_url=base_url, session_key=sessionKey, task_id=taskId, limit=limit)


@router.get('/file-events', response_model=ObsFileEventListOut)
async def file_events(
    cursor: str = '$',
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ObsFileEventListOut:
    next_cursor, items = await list_user_file_events(db=db, user=user, cursor=cursor, limit=limit)
    return ObsFileEventListOut(cursor=next_cursor, items=items)
