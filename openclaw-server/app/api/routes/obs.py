from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.obs import ObsUploadIn, ObsUploadOut
from app.services.config_service import get_admin_config
from app.services.obs_service import upload_to_obs, parse_download_token, _build_s3_client

router = APIRouter(prefix='/api/obs', tags=['obs'])


@router.post('/upload', response_model=ObsUploadOut)
async def upload(
    payload: ObsUploadIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ObsUploadOut:
    base_url = str(request.base_url).rstrip('/')
    return await upload_to_obs(db, payload, user, base_url)


@router.get('/download')
async def download(
    token: str = Query(..., min_length=1),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    parsed = parse_download_token(token)
    if not parsed:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid or expired download token')

    token_user = (parsed.get('username') or '').strip().lower()
    current_user = user.username.strip().lower()
    if token_user and token_user != current_user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='download token user mismatch')

    cfg = await get_admin_config(db)
    obs = cfg.obs
    if not obs.enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='OBS is disabled')
    if not obs.endpoint or not obs.accessKey or not obs.secretKey:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='OBS is not fully configured')

    s3 = _build_s3_client(obs.endpoint, obs.accessKey, obs.secretKey, obs.region)
    try:
        result = s3.get_object(Bucket=parsed['bucket'], Key=parsed['object_key'])
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f'file not found: {exc}') from exc

    content_type = (result.get('ContentType') or 'application/octet-stream') if isinstance(result, dict) else 'application/octet-stream'
    body = result['Body']
    headers = {'Content-Disposition': f'attachment; filename="{parsed["file_name"]}"'}
    return StreamingResponse(body.iter_chunks(), media_type=content_type, headers=headers)
