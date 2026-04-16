from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password, create_access_token
from app.db.models import User, AuthDeviceCode
from app.schemas.auth import LoginIn, LoginOut, AuthUserOut, SsoStartIn, SsoStartOut, SsoPollIn, SsoPollOut, ChangePasswordIn
from app.core.security import hash_password


def _to_auth_user(user: User) -> AuthUserOut:
    return AuthUserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        displayName=user.display_name,
        isAdmin=user.is_admin,
        roles=user.roles or [],
    )


async def login_with_password(db: AsyncSession, payload: LoginIn) -> LoginOut:
    user = (
        await db.execute(select(User).where(User.username == payload.username.strip().lower(), User.is_active.is_(True)))
    ).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid credentials')

    token = create_access_token(user.id)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    return LoginOut(token=token, expiresAt=expires_at, provider='password', user=_to_auth_user(user))


async def sso_start(db: AsyncSession, payload: SsoStartIn, service_base_url: str) -> SsoStartOut:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    device_code = uuid4().hex
    user_code = uuid4().hex[:8].upper()
    row = AuthDeviceCode(
        device_code=device_code,
        user_code=user_code,
        provider=payload.provider,
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()

    return SsoStartOut(
        verificationUri=f'{service_base_url}/sso/verify?user_code={user_code}',
        userCode=user_code,
        deviceCode=device_code,
        expiresIn=300,
        intervalMs=2000,
    )


async def sso_poll(db: AsyncSession, payload: SsoPollIn) -> SsoPollOut:
    row = (await db.execute(select(AuthDeviceCode).where(AuthDeviceCode.device_code == payload.deviceCode))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='device code not found')

    if row.expires_at < datetime.now(timezone.utc):
        return SsoPollOut(done=False)

    if not row.approved or not row.approved_user_id:
        return SsoPollOut(done=False)

    user = (await db.execute(select(User).where(User.id == row.approved_user_id, User.is_active.is_(True)))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='approved user missing')

    token = create_access_token(user.id)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    return SsoPollOut(done=True, token=token, expiresAt=expires_at, provider=row.provider or 'sso', user=_to_auth_user(user))


async def change_password(db: AsyncSession, user: User, payload: ChangePasswordIn) -> None:
    if not verify_password(payload.currentPassword, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='current password is incorrect')
    if len(payload.newPassword) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='new password too short')
    user.password_hash = hash_password(payload.newPassword)
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
