from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext

from app.core.config import settings

# bcrypt has compatibility issues on some Python 3.14 + bcrypt combinations.
# pbkdf2_sha256 is stable and avoids native backend pitfalls in containers.
pwd_context = CryptContext(schemes=['pbkdf2_sha256'], deprecated='auto')


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes or settings.access_token_expire_minutes)
    payload = {'sub': subject, 'exp': expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    sub = payload.get('sub')
    return sub if isinstance(sub, str) else None


def create_signed_payload_token(payload: dict, expires_seconds: int = 600) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
    body = {**payload, 'exp': expire}
    return jwt.encode(body, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_signed_payload_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    return payload if isinstance(payload, dict) else None
