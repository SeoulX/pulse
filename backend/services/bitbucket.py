import re

import httpx

from core.config import settings


def parse_repo_slug(repo_url: str) -> str:
    """Extract repo slug from a Bitbucket URL.

    Supports:
      - https://bitbucket.org/metawhale/my_repo
      - git@bitbucket.org:metawhale/my_repo.git
      - metawhale/my_repo
      - my_repo
    """
    # SSH format
    m = re.search(r"bitbucket\.org[:/][\w-]+/([\w._-]+?)(?:\.git)?$", repo_url)
    if m:
        return m.group(1)
    # Workspace/repo format
    m = re.match(r"^[\w-]+/([\w._-]+)$", repo_url.strip())
    if m:
        return m.group(1)
    # Bare slug
    m = re.match(r"^[\w._-]+$", repo_url.strip())
    if m:
        return repo_url.strip()
    raise ValueError(f"Cannot parse repo slug from: {repo_url}")


def _auth():
    return (settings.BITBUCKET_USER, settings.BITBUCKET_APP_PASSWORD)


def _api(path: str) -> str:
    ws = settings.BITBUCKET_WORKSPACE
    return f"https://api.bitbucket.org/2.0/repositories/{ws}/{path}"


async def add_webhook(repo_slug: str) -> dict:
    """Add Jenkins webhook to a Bitbucket repo. Idempotent — skips if exists."""
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Check existing webhooks
        resp = await client.get(_api(f"{repo_slug}/hooks"))
        resp.raise_for_status()
        for hook in resp.json().get("values", []):
            if settings.JENKINS_WEBHOOK_URL in hook.get("url", ""):
                return {"skipped": True, "message": "Webhook already exists"}

        # Create webhook
        resp = await client.post(
            _api(f"{repo_slug}/hooks"),
            json={
                "description": "Jenkins",
                "url": settings.JENKINS_WEBHOOK_URL,
                "active": True,
                "events": ["repo:push"],
            },
        )
        resp.raise_for_status()
        return {"created": True, "uuid": resp.json().get("uuid")}


async def get_default_branch(client: httpx.AsyncClient, repo_slug: str) -> str:
    resp = await client.get(_api(repo_slug))
    resp.raise_for_status()
    return resp.json().get("mainbranch", {}).get("name", "main")


async def push_tag(repo_slug: str, tag_name: str) -> dict:
    """Create a lightweight tag on the repo's default branch HEAD."""
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Check if tag already exists
        resp = await client.get(_api(f"{repo_slug}/refs/tags/{tag_name}"))
        if resp.status_code == 200:
            return {"skipped": True, "message": f"Tag {tag_name} already exists"}

        branch = await get_default_branch(client, repo_slug)

        resp = await client.post(
            _api(f"{repo_slug}/refs/tags"),
            json={
                "name": tag_name,
                "target": {"hash": branch},
            },
        )
        resp.raise_for_status()
        return {"created": True, "tag": tag_name}
