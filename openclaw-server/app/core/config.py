from pydantic_settings import BaseSettings, SettingsConfigDict
from urllib.parse import quote_plus


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    app_name: str = 'openclaw-client'
    env: str = 'dev'
    host: str = '0.0.0.0'
    port: int = 8787

    database_url: str
    redis_url: str | None = None
    redis_host: str = '127.0.0.1'
    redis_port: int = 6379
    redis_db: int = 10
    redis_username: str | None = None
    redis_password: str | None = None
    redis_ssl: bool = False

    jwt_secret: str
    jwt_algorithm: str = 'HS256'
    access_token_expire_minutes: int = 720

    obs_verify_ssl: bool = False
    bootstrap_admin_enabled: bool = True
    bootstrap_admin_username: str = 'admin'
    bootstrap_admin_password: str = 'admin123456'
    bootstrap_admin_email: str = 'admin@example.com'
    bootstrap_admin_display_name: str = 'Admin'

    @property
    def redis_dsn(self) -> str | None:
        if self.redis_url:
            return self.redis_url
        if not self.redis_password and not self.redis_username:
            return None

        auth_part = ''
        if self.redis_username and self.redis_password:
            auth_part = f'{quote_plus(self.redis_username)}:{quote_plus(self.redis_password)}@'
        elif self.redis_password:
            auth_part = f':{quote_plus(self.redis_password)}@'
        elif self.redis_username:
            auth_part = f'{quote_plus(self.redis_username)}@'

        scheme = 'rediss' if self.redis_ssl else 'redis'
        return f'{scheme}://{auth_part}{self.redis_host}:{self.redis_port}/{self.redis_db}'


settings = Settings()
