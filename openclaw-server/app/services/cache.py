import json
from redis.asyncio import Redis

from app.core.config import settings


_redis: Redis | None = None


def redis_client() -> Redis | None:
    global _redis
    redis_dsn = settings.redis_dsn
    if not redis_dsn:
        return None
    if _redis is None:
        _redis = Redis.from_url(redis_dsn, decode_responses=True)
    return _redis


async def cache_get_json(key: str) -> dict | None:
    client = redis_client()
    if client is None:
        return None
    raw = await client.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def cache_set_json(key: str, value: dict, ttl_seconds: int = 30) -> None:
    client = redis_client()
    if client is None:
        return
    await client.set(key, json.dumps(value), ex=ttl_seconds)


async def cache_delete_prefix(prefix: str) -> None:
    client = redis_client()
    if client is None:
        return
    keys: list[str] = []
    async for key in client.scan_iter(match=f'{prefix}*', count=200):
        keys.append(key)
        if len(keys) >= 500:
            await client.delete(*keys)
            keys.clear()
    if keys:
        await client.delete(*keys)
