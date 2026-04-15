from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.routes import health, auth, client, admin, obs
from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.models import AppConfig, User
from app.db.session import engine, SessionLocal

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(client.router)
app.include_router(admin.router)
app.include_router(obs.router)


@app.on_event('startup')
async def startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        cfg = (await db.execute(select(AppConfig).where(AppConfig.id == 1))).scalar_one_or_none()
        if cfg is None:
            db.add(AppConfig(id=1))

        if settings.bootstrap_admin_enabled:
            admin_username = settings.bootstrap_admin_username.strip().lower()
            admin_user = (await db.execute(select(User).where(User.username == admin_username))).scalar_one_or_none()
            if admin_user is None:
                db.add(
                    User(
                        username=admin_username,
                        password_hash=hash_password(settings.bootstrap_admin_password),
                        email=settings.bootstrap_admin_email,
                        display_name=settings.bootstrap_admin_display_name,
                        is_admin=True,
                        roles=['admin'],
                        is_active=True,
                    )
                )
            else:
                admin_user.password_hash = hash_password(settings.bootstrap_admin_password)
                admin_user.email = settings.bootstrap_admin_email
                admin_user.display_name = settings.bootstrap_admin_display_name
                admin_user.is_admin = True
                admin_user.is_active = True
                if 'admin' not in (admin_user.roles or []):
                    admin_user.roles = [*(admin_user.roles or []), 'admin']
        await db.commit()
