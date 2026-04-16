from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AppConfig, User, UserAgentBinding
from app.schemas.config import (
    AccessControlConfig,
    AdminConfig,
    GatewayConfig,
    ObsConfig,
    PublicClientConfig,
    RuntimeClientConfig,
    SsoConfig,
)
from app.services.cache import cache_delete_prefix, cache_get_json, cache_set_json


async def _ensure_app_config(db: AsyncSession) -> AppConfig:
    row = (await db.execute(select(AppConfig).where(AppConfig.id == 1))).scalar_one_or_none()
    if row is not None:
        return row
    row = AppConfig(id=1)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_public_config(db: AsyncSession) -> PublicClientConfig:
    cache_key = 'cfg:public'
    cached = await cache_get_json(cache_key)
    if cached:
        return PublicClientConfig.model_validate(cached)

    row = await _ensure_app_config(db)
    result = PublicClientConfig(ssoEnabled=row.sso_enabled, ssoProvider=row.sso_provider)
    await cache_set_json(cache_key, result.model_dump(mode='json'), ttl_seconds=15)
    return result


async def get_runtime_config(db: AsyncSession) -> RuntimeClientConfig:
    row = await _ensure_app_config(db)
    admins = (await db.execute(select(User.username).where(User.is_admin.is_(True), User.is_active.is_(True)))).scalars().all()
    bindings = (await db.execute(select(UserAgentBinding))).scalars().all()

    return RuntimeClientConfig(
        accessControl=AccessControlConfig(
            enabled=True,
            adminUsers=[x.lower() for x in admins],
            bindings=[
                {
                    'username': b.username.lower(),
                    'gatewayId': b.gateway_id,
                    'agentId': b.agent_id,
                }
                for b in bindings
            ],
        ),
        gateways=[GatewayConfig.model_validate(item) for item in (row.gateways_json or [])],
    )


async def get_admin_config(db: AsyncSession) -> AdminConfig:
    row = await _ensure_app_config(db)
    admins = (await db.execute(select(User.username).where(User.is_admin.is_(True), User.is_active.is_(True)))).scalars().all()
    bindings = (await db.execute(select(UserAgentBinding))).scalars().all()

    return AdminConfig(
        obs=ObsConfig(
            enabled=row.obs_enabled,
            endpoint=row.obs_endpoint,
            bucket=row.obs_bucket,
            basePath=row.obs_base_path,
            accessKey=row.obs_access_key,
            secretKey=row.obs_secret_key,
            region=row.obs_region,
        ),
        sso=SsoConfig(enabled=row.sso_enabled, provider=row.sso_provider, adDomain=row.ad_domain),
        accessControl=AccessControlConfig(
            enabled=True,
            adminUsers=[x.lower() for x in admins],
            bindings=[
                {
                    'username': b.username.lower(),
                    'gatewayId': b.gateway_id,
                    'agentId': b.agent_id,
                }
                for b in bindings
            ],
        ),
        gateways=[GatewayConfig.model_validate(item) for item in (row.gateways_json or [])],
    )


async def update_admin_config(db: AsyncSession, payload: AdminConfig) -> AdminConfig:
    row = await _ensure_app_config(db)

    row.sso_enabled = payload.sso.enabled
    row.sso_provider = payload.sso.provider
    row.ad_domain = payload.sso.adDomain

    row.obs_enabled = payload.obs.enabled
    row.obs_endpoint = payload.obs.endpoint
    row.obs_bucket = payload.obs.bucket
    row.obs_base_path = payload.obs.basePath
    row.obs_access_key = payload.obs.accessKey
    row.obs_secret_key = payload.obs.secretKey
    row.obs_region = payload.obs.region
    row.gateways_json = [item.model_dump(mode='json') for item in payload.gateways]
    row.updated_at = datetime.now(timezone.utc)

    await db.execute(update(User).values(is_admin=False))
    if payload.accessControl.adminUsers:
        await db.execute(
            update(User)
            .where(User.username.in_([x.lower() for x in payload.accessControl.adminUsers]))
            .values(is_admin=True)
        )

    binding_count_by_user: dict[str, int] = {}
    for item in payload.accessControl.bindings:
        username = item.username.strip().lower()
        if not username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='binding username required')
        binding_count_by_user[username] = binding_count_by_user.get(username, 0) + 1
    conflict_users = [username for username, count in binding_count_by_user.items() if count > 1]
    if conflict_users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'user can only bind one agent: {", ".join(conflict_users)}',
        )

    await db.execute(delete(UserAgentBinding))
    for item in payload.accessControl.bindings:
        db.add(
            UserAgentBinding(
                username=item.username.strip().lower(),
                gateway_id=item.gatewayId,
                agent_id=item.agentId,
            )
        )

    await db.commit()
    await cache_delete_prefix('cfg:')
    return await get_admin_config(db)
