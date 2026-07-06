"""Connectivity probes for database endpoints.

Returns the same shape as `services.check_endpoint.check_endpoint`:

    {"status": "UP"|"DOWN"|"DEGRADED",
     "status_code": int | None,
     "response_time": float ms,
     "error": str | None}

so the existing alert pipeline (consecutive_failures, Discord/email)
fires identically regardless of probe kind.

Deep metrics (replica state, cluster health detail, replication lag,
slow queries) are intentionally out of scope — see
manComm/05-19-26/MARK-db-metrics.md.
"""

import time
from typing import Optional

import httpx

from models.endpoint import Endpoint


def _result(status: str, *, status_code: Optional[int], elapsed: float, error: Optional[str]) -> dict:
    return {
        "status": status,
        "status_code": status_code,
        "response_time": round(elapsed * 1000, 2),
        "error": error,
    }


async def check_mongo(endpoint: Endpoint) -> dict:
    """Probe MongoDB via the `ping` admin command. Counts as UP if the
    server answers, DOWN on connection / auth / timeout error."""
    # Lazy import — keeps motor cost off the hot path for non-mongo endpoints.
    from motor.motor_asyncio import AsyncIOMotorClient

    start = time.monotonic()
    client = None
    try:
        client = AsyncIOMotorClient(
            endpoint.url,
            serverSelectionTimeoutMS=endpoint.timeout * 1000,
        )
        await client.admin.command("ping")
        return _result("UP", status_code=None, elapsed=time.monotonic() - start, error=None)
    except Exception as exc:
        return _result("DOWN", status_code=None, elapsed=time.monotonic() - start, error=str(exc))
    finally:
        if client is not None:
            client.close()


async def check_elasticsearch(endpoint: Endpoint) -> dict:
    """Probe ES via `GET /_cluster/health`. Maps cluster color to status:
    green=UP, yellow=DEGRADED, red=DOWN. Network/auth failure = DOWN."""
    start = time.monotonic()
    health_url = endpoint.url.rstrip("/") + "/_cluster/health"
    try:
        async with httpx.AsyncClient(timeout=endpoint.timeout) as client:
            resp = await client.get(health_url)
        elapsed = time.monotonic() - start
        if resp.status_code != 200:
            return _result("DOWN", status_code=resp.status_code, elapsed=elapsed, error=resp.text[:200])
        color = (resp.json().get("status") or "").lower()
        status = {"green": "UP", "yellow": "DEGRADED", "red": "DOWN"}.get(color, "DEGRADED")
        return _result(status, status_code=resp.status_code, elapsed=elapsed, error=None if color == "green" else f"cluster status={color}")
    except Exception as exc:
        return _result("DOWN", status_code=None, elapsed=time.monotonic() - start, error=str(exc))


async def check_redis(endpoint: Endpoint) -> dict:
    """Probe Redis via PING. Connection string format:
    redis://[:password@]host:port[/db]"""
    # Lazy import — the `redis` dep is in requirements but only matters here.
    import redis.asyncio as redis_async

    start = time.monotonic()
    client = None
    try:
        client = redis_async.from_url(endpoint.url, socket_timeout=endpoint.timeout)
        pong = await client.ping()
        if not pong:
            return _result("DOWN", status_code=None, elapsed=time.monotonic() - start, error="PING returned false")
        return _result("UP", status_code=None, elapsed=time.monotonic() - start, error=None)
    except Exception as exc:
        return _result("DOWN", status_code=None, elapsed=time.monotonic() - start, error=str(exc))
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass


async def check_postgres(endpoint: Endpoint) -> dict:
    """Probe Postgres via `SELECT 1`. Authenticates with the credentials
    embedded in the connection string."""
    # Lazy import — asyncpg is only needed for postgres endpoints.
    import asyncpg

    start = time.monotonic()
    conn = None
    try:
        conn = await asyncpg.connect(endpoint.url, timeout=endpoint.timeout)
        await conn.fetchval("SELECT 1")
        return _result("UP", status_code=None, elapsed=time.monotonic() - start, error=None)
    except Exception as exc:
        return _result("DOWN", status_code=None, elapsed=time.monotonic() - start, error=str(exc))
    finally:
        if conn is not None:
            try:
                await conn.close()
            except Exception:
                pass


# Dispatch table — kept here so the check_endpoint dispatcher just
# looks up by kind. New protocols (mysql, redis, kafka) plug in by
# adding one async function + one entry.
PROBES = {
    "mongo": check_mongo,
    "elasticsearch": check_elasticsearch,
    "postgres": check_postgres,
    "redis": check_redis,
}
