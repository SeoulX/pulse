"""Deep DB metric collectors — one-shot reads per protocol.

Returns structured dicts shaped as:
    {"sections": [{"title": str, "rows": [(label, value), ...]},
                  ...]}

Frontend renders each section as a key/value card. No storage layer
yet — every call hits the DB live. Time-series + threshold alerts
parked under manComm/05-19-26/MARK-db-metrics.md.
"""

import asyncio
import time
from typing import Any

import httpx


# ─────────────────── helpers ──────────────────────────────────────


def _bytes_human(n: Any) -> str:
    """Render bytes in MiB/GiB for the UI. Accepts int-ish or None."""
    try:
        n = int(n)
    except (TypeError, ValueError):
        return "—"
    if n >= 1 << 40:
        return f"{n / (1 << 40):.2f} TiB"
    if n >= 1 << 30:
        return f"{n / (1 << 30):.2f} GiB"
    if n >= 1 << 20:
        return f"{n / (1 << 20):.2f} MiB"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.2f} KiB"
    return f"{n} B"


def _err_section(msg: str) -> dict:
    return {"sections": [{"title": "Error", "rows": [("detail", msg)]}]}


# ─────────────────── MongoDB ──────────────────────────────────────


async def mongo_details(uri: str, timeout: int = 10) -> dict:
    from motor.motor_asyncio import AsyncIOMotorClient

    client = None
    try:
        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=timeout * 1000)
        admin = client.admin

        # Run in parallel for speed.
        status_task = admin.command("serverStatus")
        rs_task = admin.command("replSetGetStatus")
        build_task = admin.command("buildInfo")
        status, rs_status, build = await asyncio.gather(
            status_task,
            rs_task,
            build_task,
            return_exceptions=True,
        )

        sections = []
        if isinstance(status, dict):
            conns = status.get("connections", {}) or {}
            opc = status.get("opcounters", {}) or {}
            mem = status.get("mem", {}) or {}
            sections.append({
                "title": "Server",
                "rows": [
                    ("host",     status.get("host")),
                    ("version",  status.get("version") or (build.get("version") if isinstance(build, dict) else "—")),
                    ("uptime",   f"{int(status.get('uptime') or 0)} s"),
                    ("process",  status.get("process")),
                ],
            })
            sections.append({
                "title": "Connections",
                "rows": [
                    ("current",      conns.get("current")),
                    ("available",    conns.get("available")),
                    ("totalCreated", conns.get("totalCreated")),
                    ("active",       conns.get("active")),
                ],
            })
            sections.append({
                "title": "Op counters (since restart)",
                "rows": [(k, opc.get(k)) for k in ("insert","query","update","delete","getmore","command")],
            })
            sections.append({
                "title": "Memory",
                "rows": [
                    ("resident_MiB", mem.get("resident")),
                    ("virtual_MiB",  mem.get("virtual")),
                    ("mapped_MiB",   mem.get("mapped")),
                ],
            })

        # If every command raised an exception, sections will still be
        # empty here — surface what happened so the UI doesn't look broken.
        if not sections:
            errs = []
            for nm, v in (("serverStatus", status), ("replSetGetStatus", rs_status), ("buildInfo", build)):
                if isinstance(v, Exception):
                    errs.append((nm, str(v)))
            if errs:
                return {"sections": [{"title": "Error (no command succeeded)", "rows": errs}]}

        if isinstance(rs_status, dict):
            members = rs_status.get("members", []) or []
            primary = next(
                (m.get("name") for m in members if m.get("stateStr") == "PRIMARY"),
                None,
            )
            sections.append({
                "title": f"Replica set: {rs_status.get('set','—')}",
                "rows": [
                    ("myState",  rs_status.get("myState")),
                    ("primary",  primary),
                    ("members",  len(members)),
                ],
            })
            # Per-member roster — state + health + replication lag.
            # Lag relative to the primary's optime; computed from
            # optimeDate which Mongo provides on every member.
            primary_optime = next(
                (m.get("optimeDate") for m in members if m.get("stateStr") == "PRIMARY"),
                None,
            )
            roster_rows = []
            for m in members:
                lag = "—"
                if primary_optime and m.get("optimeDate") and m.get("stateStr") != "PRIMARY":
                    try:
                        delta = (primary_optime - m["optimeDate"]).total_seconds()
                        lag = f"{delta:.1f} s"
                    except Exception:
                        pass
                roster_rows.append((
                    m.get("name"),
                    f"{m.get('stateStr')}  health={m.get('health')}  lag={lag}",
                ))
            sections.append({"title": "Members (roster)", "rows": roster_rows})

            # Per-member serverStatus — connect direct to each so the
            # snapshot shows real connection counts / opcounters /
            # memory per node, not just whoever we hit first. Probes
            # run in parallel; failures surface as an "unreachable"
            # row instead of blocking the whole details fetch.
            from motor.motor_asyncio import AsyncIOMotorClient as _MC
            from urllib.parse import urlsplit, urlunsplit

            split = urlsplit(uri)

            async def _member_status(name: str) -> tuple[str, dict | str]:
                # Rewrite the netloc to point at just this member, force
                # directConnection so pymongo doesn't go back to RS
                # discovery (which would land on whatever's primary).
                userinfo = ""
                if split.username:
                    userinfo = split.username
                    if split.password:
                        userinfo += f":{split.password}"
                    userinfo += "@"
                member_uri = urlunsplit((split.scheme, f"{userinfo}{name}", "/", "authSource=admin&directConnection=true", ""))
                mc = _MC(member_uri, serverSelectionTimeoutMS=4000)
                try:
                    s = await mc.admin.command("serverStatus")
                    return name, s
                except Exception as exc:
                    return name, f"unreachable: {exc}"
                finally:
                    mc.close()

            member_names = [m.get("name") for m in members if m.get("name")]
            per_member = await asyncio.gather(
                *[_member_status(n) for n in member_names],
                return_exceptions=True,
            )
            for entry in per_member:
                if isinstance(entry, Exception):
                    continue
                name, s = entry
                if isinstance(s, str):
                    sections.append({"title": f"Member · {name}", "rows": [("status", s[:200])]})
                    continue
                conns = (s.get("connections") or {})
                opc = (s.get("opcounters") or {})
                mem = (s.get("mem") or {})
                sections.append({
                    "title": f"Member · {name}  ({s.get('host','?')})",
                    "rows": [
                        ("role/version",     f"{s.get('process','?')} {s.get('version','?')}"),
                        ("uptime",           f"{int(s.get('uptime') or 0)} s"),
                        ("connections.current", conns.get("current")),
                        ("connections.active",  conns.get("active")),
                        ("opcounters.query",    opc.get("query")),
                        ("opcounters.insert",   opc.get("insert")),
                        ("opcounters.update",   opc.get("update")),
                        ("opcounters.delete",   opc.get("delete")),
                        ("mem.resident_MiB",    mem.get("resident")),
                    ],
                })

        return {"sections": sections}
    except Exception as exc:
        return _err_section(str(exc))
    finally:
        if client is not None:
            client.close()


# ─────────────────── Elasticsearch ────────────────────────────────


async def elasticsearch_details(base_url: str, timeout: int = 10) -> dict:
    base = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            health_r, nodes_r, cat_r = await asyncio.gather(
                c.get(f"{base}/_cluster/health"),
                c.get(f"{base}/_nodes/stats/jvm,fs,os"),
                c.get(f"{base}/_cat/indices?format=json&h=index,docs.count,store.size,health"),
                return_exceptions=True,
            )

        sections = []
        if not isinstance(health_r, Exception) and health_r.status_code == 200:
            h = health_r.json()
            sections.append({
                "title": "Cluster health",
                "rows": [
                    ("cluster",                h.get("cluster_name")),
                    ("status",                 h.get("status")),
                    ("nodes",                  h.get("number_of_nodes")),
                    ("data nodes",             h.get("number_of_data_nodes")),
                    ("active primary shards",  h.get("active_primary_shards")),
                    ("active shards",          h.get("active_shards")),
                    ("relocating",             h.get("relocating_shards")),
                    ("initializing",           h.get("initializing_shards")),
                    ("unassigned",             h.get("unassigned_shards")),
                    ("pending tasks",          h.get("number_of_pending_tasks")),
                    ("active shards %",        h.get("active_shards_percent_as_number")),
                ],
            })

        if not isinstance(nodes_r, Exception) and nodes_r.status_code == 200:
            nodes = (nodes_r.json().get("nodes") or {})
            for node_id, n in nodes.items():
                jvm = (n.get("jvm") or {}).get("mem", {}) or {}
                fs  = (n.get("fs")  or {}).get("total", {}) or {}
                gc  = (n.get("jvm") or {}).get("gc", {}).get("collectors", {}) or {}
                young = gc.get("young", {})
                old   = gc.get("old", {})
                sections.append({
                    "title": f"Node: {n.get('name','?')}",
                    "rows": [
                        ("heap used %",  jvm.get("heap_used_percent")),
                        ("heap used",    jvm.get("heap_used")),
                        ("heap max",     jvm.get("heap_max")),
                        ("fs total",     _bytes_human(fs.get("total_in_bytes"))),
                        ("fs free",      _bytes_human(fs.get("free_in_bytes"))),
                        ("fs available", _bytes_human(fs.get("available_in_bytes"))),
                        ("young gc count", young.get("collection_count")),
                        ("young gc ms",    young.get("collection_time_in_millis")),
                        ("old gc count",   old.get("collection_count")),
                        ("old gc ms",      old.get("collection_time_in_millis")),
                    ],
                })

        if not isinstance(cat_r, Exception) and cat_r.status_code == 200:
            indices = cat_r.json()
            total_docs = sum(int(i.get("docs.count") or 0) for i in indices)
            sections.append({
                "title": "Indices (top 10 by docs)",
                "rows": [
                    ("total indices", len(indices)),
                    ("total docs", total_docs),
                ] + [
                    (i.get("index"), f"docs={i.get('docs.count')}  size={i.get('store.size')}  health={i.get('health')}")
                    for i in sorted(indices, key=lambda x: int(x.get("docs.count") or 0), reverse=True)[:10]
                ],
            })

        if not sections:
            return _err_section("No data returned (auth or unreachable)")
        return {"sections": sections}
    except Exception as exc:
        return _err_section(str(exc))


# ─────────────────── Postgres ─────────────────────────────────────


async def postgres_details(uri: str, timeout: int = 10) -> dict:
    import asyncpg

    conn = None
    try:
        conn = await asyncpg.connect(uri, timeout=timeout)
        ver = await conn.fetchval("SHOW server_version")
        uptime = await conn.fetchval(
            "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint"
        )
        dbname = await conn.fetchval("SELECT current_database()")
        dbsize = await conn.fetchval("SELECT pg_database_size(current_database())")

        stat_db = await conn.fetchrow(
            "SELECT numbackends, xact_commit, xact_rollback, blks_hit, blks_read, "
            "tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, "
            "conflicts, deadlocks "
            "FROM pg_stat_database WHERE datname = current_database()"
        )
        activity_summary = await conn.fetch(
            "SELECT state, COUNT(*) AS n FROM pg_stat_activity "
            "WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC"
        )
        long_running = await conn.fetch(
            "SELECT pid, usename, application_name, state, "
            "EXTRACT(EPOCH FROM (now() - query_start))::int AS secs, "
            "LEFT(query, 80) AS q "
            "FROM pg_stat_activity "
            "WHERE state = 'active' AND query_start < now() - interval '30 seconds' "
            "ORDER BY secs DESC LIMIT 5"
        )
        replication = await conn.fetch(
            "SELECT client_addr, state, sync_state, "
            "pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes "
            "FROM pg_stat_replication"
        )

        # Cache hit ratio — useful single number.
        hit, read = (stat_db["blks_hit"] or 0, stat_db["blks_read"] or 0) if stat_db else (0, 0)
        cache_hit = round(100.0 * hit / (hit + read), 2) if (hit + read) else None

        sections = [
            {
                "title": "Server",
                "rows": [
                    ("version",   ver),
                    ("uptime",    f"{uptime} s"),
                    ("database",  dbname),
                    ("size",      _bytes_human(dbsize)),
                ],
            },
            {
                "title": "Database stats",
                "rows": [
                    ("backends",       stat_db["numbackends"]   if stat_db else "—"),
                    ("xact_commit",    stat_db["xact_commit"]   if stat_db else "—"),
                    ("xact_rollback",  stat_db["xact_rollback"] if stat_db else "—"),
                    ("blks_hit",       stat_db["blks_hit"]      if stat_db else "—"),
                    ("blks_read",      stat_db["blks_read"]     if stat_db else "—"),
                    ("cache hit %",    cache_hit),
                    ("tup_inserted",   stat_db["tup_inserted"]  if stat_db else "—"),
                    ("tup_updated",    stat_db["tup_updated"]   if stat_db else "—"),
                    ("tup_deleted",    stat_db["tup_deleted"]   if stat_db else "—"),
                    ("conflicts",      stat_db["conflicts"]     if stat_db else "—"),
                    ("deadlocks",      stat_db["deadlocks"]     if stat_db else "—"),
                ],
            },
            {
                "title": "Activity",
                "rows": [(r["state"], r["n"]) for r in activity_summary] or [("(none)", 0)],
            },
            {
                "title": "Long-running queries (>30s)",
                "rows": [
                    (f"pid={r['pid']} ({r['secs']}s, {r['application_name'] or '-'})", r["q"])
                    for r in long_running
                ] or [("(none)", "")],
            },
            {
                "title": "Replication",
                "rows": [
                    (f"{r['client_addr']} ({r['state']}/{r['sync_state']})", f"lag={_bytes_human(r['lag_bytes'])}")
                    for r in replication
                ] or [("(no standbys)", "")],
            },
        ]
        return {"sections": sections}
    except Exception as exc:
        return _err_section(str(exc))
    finally:
        if conn is not None:
            try:
                await conn.close()
            except Exception:
                pass


# ─────────────────── Redis ────────────────────────────────────────


_REDIS_INFO_SECTIONS = ("server", "clients", "memory", "stats", "replication", "persistence", "cpu")


async def redis_details(uri: str, timeout: int = 10) -> dict:
    import redis.asyncio as redis_async

    client = None
    try:
        client = redis_async.from_url(uri, socket_timeout=timeout)
        info = await client.info()
        dbsize = await client.dbsize()

        # Group selected keys per section. `info()` returns one flat dict
        # with everything; we slice into our section structure for the UI.
        def pick(*keys):
            return [(k, info.get(k)) for k in keys if k in info]

        sections = [
            {
                "title": "Server",
                "rows": pick("redis_version", "redis_mode", "os", "arch_bits",
                             "process_id", "tcp_port", "uptime_in_seconds"),
            },
            {
                "title": "Clients",
                "rows": pick("connected_clients", "cluster_connections", "blocked_clients",
                             "maxclients"),
            },
            {
                "title": "Memory",
                "rows": pick("used_memory_human", "used_memory_peak_human",
                             "used_memory_rss_human", "maxmemory_human",
                             "mem_fragmentation_ratio", "evicted_keys"),
            },
            {
                "title": "Stats",
                "rows": pick("total_commands_processed", "instantaneous_ops_per_sec",
                             "total_connections_received", "rejected_connections",
                             "keyspace_hits", "keyspace_misses", "expired_keys"),
            },
            {
                "title": "Replication",
                "rows": pick("role", "connected_slaves", "master_link_status",
                             "master_last_io_seconds_ago", "master_repl_offset",
                             "repl_backlog_size"),
            },
            {
                "title": "Persistence",
                "rows": pick("rdb_changes_since_last_save", "rdb_bgsave_in_progress",
                             "rdb_last_save_time", "aof_enabled", "aof_rewrite_in_progress"),
            },
            {
                "title": "Keyspace",
                "rows": [(f"db (current)", f"{dbsize} keys")],
            },
        ]
        return {"sections": sections}
    except Exception as exc:
        return _err_section(str(exc))
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass


# ─────────────────── Dispatch ─────────────────────────────────────


DETAILS = {
    "mongo":         lambda uri, timeout=10: mongo_details(uri, timeout),
    "elasticsearch": lambda uri, timeout=10: elasticsearch_details(uri, timeout),
    "postgres":      lambda uri, timeout=10: postgres_details(uri, timeout),
    "redis":         lambda uri, timeout=10: redis_details(uri, timeout),
}
