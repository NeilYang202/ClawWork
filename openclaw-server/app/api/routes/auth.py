from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import LoginIn, LoginOut, SsoPollIn, SsoPollOut, SsoStartIn, SsoStartOut, ChangePasswordIn
from app.services.auth_service import login_with_password, sso_poll, sso_start, change_password

router = APIRouter(prefix='/api/auth', tags=['auth'])


@router.post('/login', response_model=LoginOut)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)) -> LoginOut:
    return await login_with_password(db, payload)


@router.post('/sso/start', response_model=SsoStartOut)
async def start_sso(payload: SsoStartIn, request: Request, db: AsyncSession = Depends(get_db)) -> SsoStartOut:
    base = str(request.base_url).rstrip('/')
    return await sso_start(db, payload, base)


@router.post('/sso/poll', response_model=SsoPollOut)
async def poll_sso(payload: SsoPollIn, db: AsyncSession = Depends(get_db)) -> SsoPollOut:
    return await sso_poll(db, payload)


@router.post('/change-password')
async def post_change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await change_password(db, user, payload)
    return {'ok': True}
