"""Infisical automation — bootstrap project + env + folder on approve.

Called from `api/handlers/deployments.py:approve_deployment` when the
deployment has `secrets_enabled=True`. Idempotent: safe to re-run on
existing scopes; Pulse will pick up the existing project/env/folder
IDs and no-op on already-created resources.

Only project/env/folder shapes are managed here. Secret VALUES are
never touched by Pulse — devs put those in via the Infisical UI so the
plaintext never flows through our services.

Auth: universal-auth machine identity. Store clientId + clientSecret in
Pulse .env as INFISICAL_ADMIN_CLIENT_ID + INFISICAL_ADMIN_CLIENT_SECRET.
Access-token cache honours the login response's expiresIn so most calls
skip the login round-trip.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Iterable, Optional

import httpx

from core.config import settings

log = logging.getLogger("pulse.infisical")

_TOKEN_CACHE: dict[str, Any] = {"access": None, "exp": 0.0}


def is_configured() -> bool:
    return bool(
        settings.INFISICAL_HOST_API
        and settings.INFISICAL_ADMIN_CLIENT_ID
        and settings.INFISICAL_ADMIN_CLIENT_SECRET
    )


async def _login(client: httpx.AsyncClient) -> str:
    """Exchange client id/secret for an access token. 60s slop on the
    cached-expiry check so we don't hand back a token that'll expire
    mid-request."""
    now = time.time()
    if _TOKEN_CACHE["access"] and _TOKEN_CACHE["exp"] > now + 60:
        return _TOKEN_CACHE["access"]
    r = await client.post(
        "/v1/auth/universal-auth/login",
        json={
            "clientId": settings.INFISICAL_ADMIN_CLIENT_ID,
            "clientSecret": settings.INFISICAL_ADMIN_CLIENT_SECRET,
        },
    )
    r.raise_for_status()
    data = r.json()
    _TOKEN_CACHE["access"] = data["accessToken"]
    _TOKEN_CACHE["exp"] = now + int(data.get("expiresIn", 900))
    return _TOKEN_CACHE["access"]


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=settings.INFISICAL_HOST_API, timeout=15.0)


async def ensure_project(slug: str, name: str) -> Optional[str]:
    """Return the project ID, creating the project if missing.

    Infisical returns 404 on `by-slug/{slug}` when the project doesn't
    exist. On create the response envelope differs across v1/v2 — try v2
    first (POST /v2/workspace) then fall back to v1. Returns None on
    unrecoverable API errors so the caller can decide whether to log +
    proceed or bail.
    """
    async with await _client() as c:
        token = await _login(c)
        h = {"Authorization": f"Bearer {token}"}

        # Fast path — already exists.
        r = await c.get(f"/v1/workspace/by-slug/{slug}", headers=h)
        if r.status_code == 200:
            body = r.json()
            ws = body.get("workspace") or body.get("project") or {}
            pid = ws.get("id") or ws.get("_id")
            if pid:
                log.info("infisical project %s already exists id=%s", slug, pid)
                return pid

        # Create.
        payload = {"projectName": name, "slug": slug}
        r = await c.post("/v2/workspace", headers=h, json=payload)
        if r.status_code >= 400:
            # Fallback to v1 shape used by older Infisical versions.
            r = await c.post("/v1/workspace", headers=h, json=payload)
        if r.status_code >= 400:
            log.warning("infisical create project %s -> HTTP %d body=%s",
                        slug, r.status_code, r.text[:400])
            return None
        body = r.json()
        proj = body.get("project") or body.get("workspace") or {}
        pid = proj.get("id") or proj.get("_id")
        log.info("infisical project %s created id=%s", slug, pid)
        return pid


async def ensure_environment(project_id: str, env_slug: str, env_name: Optional[str] = None) -> bool:
    """Create the env if missing. 400/409 from Infisical typically means
    already-exists (env slug collision) — treat as success."""
    name = env_name or env_slug.capitalize()
    async with await _client() as c:
        token = await _login(c)
        h = {"Authorization": f"Bearer {token}"}
        r = await c.post(
            f"/v1/workspace/{project_id}/environments",
            headers=h,
            json={"name": name, "slug": env_slug},
        )
        if r.status_code < 400:
            log.info("infisical env %s/%s created", project_id, env_slug)
            return True
        if r.status_code in (400, 409):
            log.info("infisical env %s/%s already exists", project_id, env_slug)
            return True
        log.warning("infisical env %s/%s -> HTTP %d body=%s",
                    project_id, env_slug, r.status_code, r.text[:400])
        return False


async def ensure_folder(project_id: str, env_slug: str, path: str) -> bool:
    """Walk path segments so nested paths idempotently reach the target.

    Infisical creates each folder relative to its parent, so `/a/b/c`
    needs three calls: `/a` under root, `/b` under `/a`, `/c` under
    `/a/b`. Failures on intermediate segments abort further creates.
    """
    parts = [p for p in path.strip("/").split("/") if p]
    if not parts:
        return True

    async with await _client() as c:
        token = await _login(c)
        h = {"Authorization": f"Bearer {token}"}

        cur_dir = "/"
        for p in parts:
            payload = {
                "workspaceId": project_id,
                "environment": env_slug,
                "path": cur_dir,          # parent directory
                "name": p,                 # folder to create inside parent
                "directory": (cur_dir.rstrip("/") + "/" + p),  # some API versions expect this
            }
            r = await c.post("/v1/folders", headers=h, json=payload)
            if r.status_code < 400:
                pass
            elif r.status_code in (400, 409):
                # already exists — expected during idempotent replay
                pass
            else:
                log.warning(
                    "infisical folder %s/%s dir=%s name=%s -> HTTP %d body=%s",
                    project_id, env_slug, cur_dir, p, r.status_code, r.text[:400],
                )
                return False
            cur_dir = (cur_dir.rstrip("/") + "/" + p)
        log.info("infisical folder %s/%s path=%s ensured",
                 project_id, env_slug, path)
        return True


async def bootstrap_scope(
    *,
    project_slug: str,
    project_name: str,
    envs: Iterable[str],
    paths: Iterable[str],
) -> Optional[str]:
    """Ensure project + all (env × path) combinations. Returns the
    project ID on success or None when even the project step failed."""
    if not is_configured():
        log.info("infisical bootstrap skipped — creds not configured")
        return None
    pid = await ensure_project(project_slug, project_name)
    if not pid:
        return None
    env_list = list(envs)
    path_list = list(paths) or ["/"]
    for env in env_list:
        await ensure_environment(pid, env)
        for path in path_list:
            await ensure_folder(pid, env, path)
    return pid
