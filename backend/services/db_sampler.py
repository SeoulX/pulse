"""Background DB sampler — periodic probe loop for history charts.

Runs in-process via an asyncio task kicked off in the FastAPI
lifespan. Every PULSE_DB_SAMPLE_INTERVAL seconds (default 60s) it
walks the same `_INVENTORY` the UI uses, runs each protocol probe,
extracts a small numeric metrics dict, and inserts a DbMetricSample.

Lean by design — Phase B.1 stores status + response_time. Phase B.2
will fill `metrics` with protocol-specific values for chart series.

External orchestration (k8s CronJob, argo workflow) deliberately not
required — the only thing needed to start sampling is for the pod
to be up.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone

from core.config import settings
from models.endpoint import Endpoint
from models.db_metric_sample import DbMetricSample
from services.check_db import PROBES
from services.db_alert import maybe_alert

# Re-import the inventory the handler uses so we sample exactly what
# the UI lists. Avoids a divergent second source of truth.
from api.handlers.databases import _INVENTORY


log = logging.getLogger("db_sampler")


async def _extract_metrics(kind: str, uri: str, timeout: int = 10) -> dict:
    """Pull a small, cheap set of protocol-specific numeric metrics so
    the dashboard can chart them as time series.

    Lean by design — each kind grabs one or two cheap commands. If a
    call errors, we return an empty dict for that kind rather than
    poisoning the whole sample (probe status still records UP/DOWN).
    """
    try:
        if kind == "mongo":
            from motor.motor_asyncio import AsyncIOMotorClient
            from urllib.parse import urlsplit, urlunsplit
            c = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=timeout * 1000)
            try:
                # Primary's serverStatus + replSetGetStatus to enumerate members.
                s, rs = await asyncio.gather(
                    c.admin.command("serverStatus"),
                    c.admin.command("replSetGetStatus"),
                    return_exceptions=True,
                )
                if isinstance(s, Exception):
                    return {}
                conns = (s.get("connections") or {})
                opc = (s.get("opcounters") or {})
                mem = (s.get("mem") or {})
                out: dict = {
                    "connections_current":   conns.get("current"),
                    "connections_active":    conns.get("active"),
                    "connections_available": conns.get("available"),
                    "opcounters_query":      opc.get("query"),
                    "opcounters_insert":     opc.get("insert"),
                    "opcounters_update":     opc.get("update"),
                    "opcounters_delete":     opc.get("delete"),
                    "opcounters_command":    opc.get("command"),
                    "mem_resident_mb":       mem.get("resident"),
                    "uptime_seconds":        s.get("uptime"),
                }
                # Per-member sampling. Each member probed independently
                # with directConnection so we don't re-route back to the
                # primary. Keys are prefixed `member__<host>__<metric>`
                # so the dashboard can pick them up by suffix pattern.
                if isinstance(rs, dict):
                    members = rs.get("members") or []
                    primary_optime = next(
                        (m.get("optimeDate") for m in members if m.get("stateStr") == "PRIMARY"),
                        None,
                    )
                    split = urlsplit(uri)
                    userinfo = ""
                    if split.username:
                        userinfo = split.username
                        if split.password:
                            userinfo += f":{split.password}"
                        userinfo += "@"

                    async def _member(m: dict):
                        name = m.get("name") or "?"
                        # Replication lag (secs) relative to primary, if known.
                        lag_s = None
                        if primary_optime and m.get("optimeDate") and m.get("stateStr") != "PRIMARY":
                            try:
                                lag_s = round((primary_optime - m["optimeDate"]).total_seconds(), 2)
                            except Exception:
                                pass
                        result: dict = {
                            f"member__{name}__state":     m.get("stateStr"),
                            f"member__{name}__health":    m.get("health"),
                            f"member__{name}__lag_sec":   lag_s,
                        }
                        # Direct connect for live stats (skip if it's the
                        # one we already polled to save a round-trip).
                        member_uri = urlunsplit((split.scheme, f"{userinfo}{name}", "/", "authSource=admin&directConnection=true", ""))
                        mc = AsyncIOMotorClient(member_uri, serverSelectionTimeoutMS=4000)
                        try:
                            ss = await mc.admin.command("serverStatus")
                            mconns = (ss.get("connections") or {})
                            mopc   = (ss.get("opcounters") or {})
                            mmem   = (ss.get("mem") or {})
                            result.update({
                                f"member__{name}__connections_current": mconns.get("current"),
                                f"member__{name}__opcounters_query":    mopc.get("query"),
                                f"member__{name}__opcounters_insert":   mopc.get("insert"),
                                f"member__{name}__opcounters_update":   mopc.get("update"),
                                f"member__{name}__opcounters_delete":   mopc.get("delete"),
                                f"member__{name}__mem_resident_mb":     mmem.get("resident"),
                                f"member__{name}__uptime_seconds":      ss.get("uptime"),
                            })
                        except Exception:
                            result[f"member__{name}__reachable"] = 0
                        finally:
                            mc.close()
                        return result

                    per = await asyncio.gather(
                        *[_member(m) for m in members],
                        return_exceptions=True,
                    )
                    for r in per:
                        if isinstance(r, dict):
                            out.update(r)
                return out
            finally:
                c.close()

        if kind == "redis":
            import redis.asyncio as redis_async
            c = redis_async.from_url(uri, socket_timeout=timeout)
            try:
                info = await c.info()
                return {
                    "connected_clients":          info.get("connected_clients"),
                    "blocked_clients":            info.get("blocked_clients"),
                    "used_memory_bytes":          info.get("used_memory"),
                    "used_memory_peak_bytes":     info.get("used_memory_peak"),
                    "ops_per_sec":                info.get("instantaneous_ops_per_sec"),
                    "total_commands_processed":   info.get("total_commands_processed"),
                    "keyspace_hits":              info.get("keyspace_hits"),
                    "keyspace_misses":            info.get("keyspace_misses"),
                    "expired_keys":               info.get("expired_keys"),
                    "evicted_keys":               info.get("evicted_keys"),
                    "uptime_seconds":             info.get("uptime_in_seconds"),
                }
            finally:
                try: await c.aclose()
                except Exception: pass

        if kind == "elasticsearch":
            import httpx
            base = uri.rstrip("/")
            async with httpx.AsyncClient(timeout=timeout) as cli:
                h_r = await cli.get(f"{base}/_cluster/health")
                nodes_r = await cli.get(f"{base}/_nodes/stats/jvm,fs")
            if h_r.status_code != 200:
                return {}
            h = h_r.json()
            heap_max = None
            if nodes_r.status_code == 200:
                heap_max = max(
                    (
                        ((n.get("jvm") or {}).get("mem") or {}).get("heap_used_percent") or 0
                        for n in (nodes_r.json().get("nodes") or {}).values()
                    ),
                    default=None,
                )
            return {
                "active_primary_shards":          h.get("active_primary_shards"),
                "active_shards":                  h.get("active_shards"),
                "relocating_shards":              h.get("relocating_shards"),
                "initializing_shards":            h.get("initializing_shards"),
                "unassigned_shards":              h.get("unassigned_shards"),
                "active_shards_percent":          h.get("active_shards_percent_as_number"),
                "number_of_nodes":                h.get("number_of_nodes"),
                "heap_used_percent_max":          heap_max,
            }

        if kind == "postgres":
            import asyncpg
            conn = await asyncpg.connect(uri, timeout=timeout)
            try:
                row = await conn.fetchrow(
                    "SELECT numbackends, xact_commit, xact_rollback, blks_hit, blks_read, "
                    "tup_inserted, tup_updated, tup_deleted, deadlocks, "
                    "pg_database_size(current_database()) AS db_size "
                    "FROM pg_stat_database WHERE datname = current_database()"
                )
                if not row:
                    return {}
                hit, read = (row["blks_hit"] or 0), (row["blks_read"] or 0)
                ratio = round(100.0 * hit / (hit + read), 2) if (hit + read) else None
                return {
                    "backends":          row["numbackends"],
                    "xact_commit":       row["xact_commit"],
                    "xact_rollback":     row["xact_rollback"],
                    "blks_hit":          row["blks_hit"],
                    "blks_read":         row["blks_read"],
                    "cache_hit_percent": ratio,
                    "tup_inserted":      row["tup_inserted"],
                    "tup_updated":       row["tup_updated"],
                    "tup_deleted":       row["tup_deleted"],
                    "deadlocks":         row["deadlocks"],
                    "db_size_bytes":     row["db_size"],
                }
            finally:
                try: await conn.close()
                except Exception: pass
    except Exception as exc:
        log.warning("extract_metrics(%s, %s) failed: %s", kind, env_key_for_log(uri), exc)
        return {}
    return {}


def env_key_for_log(uri: str) -> str:
    """Mask creds for logging."""
    try:
        if "://" in uri and "@" in uri:
            scheme, rest = uri.split("://", 1)
            _, hostpart = rest.split("@", 1)
            return f"{scheme}://***@{hostpart.split('/', 1)[0]}"
    except Exception:
        pass
    return "?"


async def _sample_one(env_key: str, kind: str) -> None:
    """Probe a single env key, insert one DbMetricSample. Errors logged
    but never propagated — sampler keeps running."""
    uri = os.environ.get(env_key, "").strip()
    if not uri:
        return  # Skip empty keys; they don't appear in the UI either.

    probe_fn = PROBES.get(kind)
    if probe_fn is None:
        return  # No probe for this kind yet (e.g. minio/clickhouse).

    # Transient Endpoint matches the on-demand probe path.
    ep = Endpoint(
        name=f"sample:{env_key}",
        kind=kind,  # type: ignore[arg-type]
        url=uri,
        timeout=10,
    )

    # Probe + metric extraction in parallel so the sample carries both.
    probe_task = probe_fn(ep)
    metrics_task = _extract_metrics(kind, uri)
    probe_res, metrics = await asyncio.gather(
        probe_task, metrics_task, return_exceptions=True,
    )
    if isinstance(probe_res, Exception):
        probe_res = {"status": "DOWN", "status_code": None,
                     "response_time": 0.0, "error": f"sampler: {probe_res}"}
    if isinstance(metrics, Exception) or not isinstance(metrics, dict):
        metrics = {}

    sample = DbMetricSample(
        key=env_key,
        kind=kind,
        captured_at=datetime.now(timezone.utc),
        status=probe_res.get("status", "DOWN"),
        response_time_ms=probe_res.get("response_time", 0.0) or 0.0,
        error=probe_res.get("error"),
        metrics=metrics,
    )
    try:
        await sample.insert()
    except Exception as exc:
        log.warning("sampler insert failed for %s: %s", env_key, exc)
        return

    # Look up the entry's label for the Discord embed. Same _INVENTORY
    # the handler uses, so labels stay consistent UI↔alert.
    label = env_key
    for k, entries in _INVENTORY.items():
        for ek, lbl in entries:
            if ek == env_key:
                label = lbl
                break

    await maybe_alert(
        key=env_key,
        kind=kind,
        label=label,
        current_status=sample.status,
        response_time_ms=sample.response_time_ms,
        error=sample.error,
    )


async def _tick() -> None:
    """One pass over the entire inventory — concurrent per-DB probes."""
    tasks = []
    for kind, entries in _INVENTORY.items():
        for env_key, _label in entries:
            tasks.append(_sample_one(env_key, kind))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def run_sampler_loop() -> None:
    """Forever loop with sleep — cancelled on app shutdown.

    First tick fires immediately on startup so we have at least one
    sample without waiting a full interval; subsequent ticks honor
    PULSE_DB_SAMPLE_INTERVAL.
    """
    interval = max(15, getattr(settings, "PULSE_DB_SAMPLE_INTERVAL", 60))
    log.info("db_sampler starting (interval=%ds)", interval)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # One bad tick shouldn't kill the whole loop.
            log.warning("db_sampler tick failed: %s", exc)
        await asyncio.sleep(interval)
