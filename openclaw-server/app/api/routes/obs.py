from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.obs import ObsUploadIn, ObsUploadOut
from app.services.obs_service import upload_to_obs

router = APIRouter(prefix='/api/obs', tags=['obs'])


@router.post('/upload', response_model=ObsUploadOut)
async def upload(
    payload: ObsUploadIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ObsUploadOut:
    return await upload_to_obs(db, payload, user)

