from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db.models import User
from app.db.session import get_db
from app.schemas.auth import AdminCreateUserIn, AdminUpdateUserIn, AdminUserOut
from app.schemas.config import AdminConfig
from app.services.config_service import get_admin_config, update_admin_config
from app.services.user_service import list_users, create_user, update_user, delete_user

router = APIRouter(prefix='/api/admin', tags=['admin'])


@router.get('/config', response_model=AdminConfig)
async def admin_get_config(
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminConfig:
    return await get_admin_config(db)


@router.put('/config', response_model=AdminConfig)
async def admin_put_config(
    payload: AdminConfig,
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminConfig:
    return await update_admin_config(db, payload)


@router.get('/users', response_model=list[AdminUserOut])
async def admin_list_users(
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserOut]:
    return await list_users(db)


@router.post('/users', response_model=AdminUserOut)
async def admin_create_user(
    payload: AdminCreateUserIn,
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    return await create_user(db, payload)


@router.patch('/users/{user_id}', response_model=AdminUserOut)
async def admin_update_user(
    user_id: str,
    payload: AdminUpdateUserIn,
    _user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserOut:
    return await update_user(db, user_id, payload)


@router.delete('/users/{user_id}')
async def admin_delete_user(
    user_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    await delete_user(db, user_id, user.id)
    return {'ok': True}
