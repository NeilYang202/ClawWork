from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint, ForeignKey, BigInteger
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = 'users'

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    roles: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class AppConfig(Base):
    __tablename__ = 'app_config'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    sso_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sso_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ad_domain: Mapped[str | None] = mapped_column(String(255), nullable=True)

    obs_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    obs_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    obs_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    obs_base_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    obs_access_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    obs_secret_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    obs_region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gateways_json: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class UserAgentBinding(Base):
    __tablename__ = 'user_agent_bindings'
    __table_args__ = (
        UniqueConstraint('username', name='uq_user_single_agent_binding'),
        UniqueConstraint('username', 'gateway_id', 'agent_id', name='uq_user_gateway_agent'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), nullable=False)
    gateway_id: Mapped[str] = mapped_column(String(128), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class AuthDeviceCode(Base):
    __tablename__ = 'auth_device_codes'

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    device_code: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    user_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approved_user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class ObsUploadRecord(Base):
    __tablename__ = 'obs_upload_records'

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    username: Mapped[str] = mapped_column(String(128), nullable=False)
    gateway_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_key: Mapped[str] = mapped_column(Text, nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    obs_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    openclaw_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
