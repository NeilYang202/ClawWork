import asyncio
import logging
from redis.asyncio import Redis as AsyncRedis
from redis import Redis as SyncRedis

from app.core.config import settings


_redis: AsyncRedis | None = None
_redis_sync: SyncRedis | None = None
logger = logging.getLogger(__name__)


def redis_client() -> AsyncRedis | None:
    global _redis
    redis_dsn = settings.redis_dsn
    if not redis_dsn:
        return None
    if _redis is None:
        _redis = AsyncRedis.from_url(redis_dsn, decode_responses=True)
    return _redis


def redis_sync_client() -> SyncRedis | None:
    global _redis_sync
    redis_dsn = settings.redis_dsn
    if not redis_dsn:
        return None
    if _redis_sync is None:
        _redis_sync = SyncRedis.from_url(redis_dsn, decode_responses=True)
    return _redis_sync


async def stream_add(name: str, fields: dict[str, str]) -> str | None:
    client = redis_client()
    if client is not None:
        try:
            return await client.xadd(name, fields)
        except Exception as exc:
            logger.warning('redis async stream_add failed: %s', exc)

    sync_client = redis_sync_client()
    if sync_client is None:
        return None
    try:
        event_id = await asyncio.to_thread(sync_client.xadd, name, fields)
        return str(event_id) if event_id is not None else None
    except Exception as exc:
        logger.warning('redis sync stream_add fallback failed: %s', exc)
        return None


async def stream_read(name: str, cursor: str = '$', count: int = 100) -> list[tuple[str, dict[str, str]]]:
    client = redis_client()
    if client is None:
        return []
    try:
        rows = await client.xread({name: cursor}, count=max(1, min(count, 500)), block=2000)
    except Exception as exc:
        logger.warning('redis stream_read failed: %s', exc)
        return []
    if not rows:
        return []
    items: list[tuple[str, dict[str, str]]] = []
    for _stream_name, events in rows:
        for event_id, payload in events:
            if isinstance(payload, dict):
                items.append((event_id, {str(k): str(v) for k, v in payload.items()}))
    return items
