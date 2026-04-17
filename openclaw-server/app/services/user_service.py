from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import User
from app.schemas.auth import AdminCreateUserIn, AdminUpdateUserIn, AdminUserOut


def _to_admin_user_out(row: User) -> AdminUserOut:
    return AdminUserOut(
        id=row.id,
        username=row.username,
        email=row.email,
        displayName=row.display_name,
        isAdmin=row.is_admin,
        isActive=row.is_active,
        roles=row.roles or [],
    )


async def list_users(db: AsyncSession) -> list[AdminUserOut]:
    rows = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return [_to_admin_user_out(r) for r in rows]


async def create_user(db: AsyncSession, payload: AdminCreateUserIn) -> AdminUserOut:
    username = payload.username.strip().lower()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='username required')
    if len(payload.password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='password too short')

    exists = (await db.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='user already exists')

    roles = set(payload.roles or [])
    if payload.isAdmin:
        roles.add('admin')
    else:
        roles.discard('admin')

    now = datetime.now(timezone.utc)
    row = User(
        username=username,
        password_hash=hash_password(payload.password),
        email=payload.email,
        display_name=payload.displayName,
        is_admin=payload.isAdmin,
        roles=list(roles),
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_admin_user_out(row)


async def update_user(db: AsyncSession, user_id: str, payload: AdminUpdateUserIn) -> AdminUserOut:
    row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user not found')

    roles = set(row.roles or [])
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='password too short')
        row.password_hash = hash_password(payload.password)
    if payload.email is not None:
        row.email = payload.email
    if payload.displayName is not None:
        row.display_name = payload.displayName
    if payload.isAdmin is not None:
        row.is_admin = payload.isAdmin
        if payload.isAdmin:
            roles.add('admin')
        else:
            roles.discard('admin')
    if payload.roles is not None:
        roles = set(payload.roles)
    if row.is_admin:
        roles.add('admin')
    else:
        roles.discard('admin')
    row.roles = list(roles)
    if payload.isActive is not None:
        row.is_active = payload.isActive
    row.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(row)
    return _to_admin_user_out(row)


async def delete_user(db: AsyncSession, user_id: str, operator_id: str) -> None:
    row = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='user not found')
    if row.id == operator_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='cannot delete current user')
    await db.delete(row)
    await db.commit()
