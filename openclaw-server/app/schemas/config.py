from pydantic import BaseModel, Field


class BindingItem(BaseModel):
    username: str
    gatewayId: str
    agentId: str
    workspacePath: str | None = None


class ObsConfig(BaseModel):
    enabled: bool = False
    endpoint: str | None = None
    bucket: str | None = None
    basePath: str | None = None
    accessKey: str | None = None
    secretKey: str | None = None
    region: str | None = None


class SsoConfig(BaseModel):
    enabled: bool = False
    provider: str | None = None
    adDomain: str | None = None


class AccessControlConfig(BaseModel):
    enabled: bool = True
    adminUsers: list[str] = Field(default_factory=list)
    bindings: list[BindingItem] = Field(default_factory=list)


class GatewayConfig(BaseModel):
    id: str
    name: str
    url: str
    token: str | None = None
    password: str | None = None
    pairingCode: str | None = None
    authMode: str | None = None
    isDefault: bool | None = None
    color: str | None = None


class PublicClientConfig(BaseModel):
    ssoEnabled: bool = False
    ssoProvider: str | None = None


class RuntimeClientConfig(BaseModel):
    accessControl: AccessControlConfig
    gateways: list[GatewayConfig] = Field(default_factory=list)


class AdminConfig(BaseModel):
    obs: ObsConfig
    sso: SsoConfig
    accessControl: AccessControlConfig
    gateways: list[GatewayConfig] = Field(default_factory=list)
