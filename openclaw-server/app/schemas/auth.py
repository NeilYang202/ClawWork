from datetime import datetime
from pydantic import BaseModel, Field


class AuthUserOut(BaseModel):
    id: str
    username: str
    email: str | None = None
    displayName: str | None = None
    isAdmin: bool = False
    roles: list[str] = Field(default_factory=list)


class LoginIn(BaseModel):
    username: str
    password: str
    realm: str | None = None
    adDomain: str | None = None
    provider: str | None = 'password'
    deviceId: str | None = None


class LoginOut(BaseModel):
    token: str
    refreshToken: str | None = None
    expiresAt: datetime | None = None
    provider: str = 'password'
    user: AuthUserOut


class SsoStartIn(BaseModel):
    provider: str | None = None
    realm: str | None = None
    adDomain: str | None = None
    deviceId: str | None = None


class SsoStartOut(BaseModel):
    verificationUri: str
    userCode: str
    deviceCode: str
    expiresIn: int = 300
    intervalMs: int = 2000


class SsoPollIn(BaseModel):
    provider: str | None = None
    deviceCode: str
    deviceId: str | None = None


class SsoPollOut(BaseModel):
    done: bool
    token: str | None = None
    refreshToken: str | None = None
    expiresAt: datetime | None = None
    provider: str | None = None
    user: AuthUserOut | None = None


class ChangePasswordIn(BaseModel):
    currentPassword: str
    newPassword: str


class AdminCreateUserIn(BaseModel):
    username: str
    password: str
    email: str | None = None
    displayName: str | None = None
    isAdmin: bool = False


class AdminUserOut(BaseModel):
    id: str
    username: str
    email: str | None = None
    displayName: str | None = None
    isAdmin: bool
    isActive: bool


class AdminUpdateUserIn(BaseModel):
    password: str | None = None
    email: str | None = None
    displayName: str | None = None
    isAdmin: bool | None = None
    isActive: bool | None = None
