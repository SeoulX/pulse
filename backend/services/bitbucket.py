import re

import httpx

from core.config import settings


ALLOWED_WORKSPACE = "metawhale"
BOOTSTRAP_TAGS = ("v0.0.0-alpha", "v0.0.0")
_RELEASE_TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:[.-].*)?$")


def parse_repo_slug(repo_url: str) -> str:
    """Extract repo slug from a Bitbucket URL. Rejects non-metawhale workspaces.

    Accepts:
      - https://bitbucket.org/metawhale/my_repo
      - git@bitbucket.org:metawhale/my_repo.git
      - metawhale/my_repo
      - my_repo (workspace implied as metawhale)
    """
    url = repo_url.strip()

    # URL with workspace (https or SSH)
    m = re.search(r"bitbucket\.org[:/]([\w-]+)/([\w._-]+?)(?:\.git)?/?$", url)
    if m:
        workspace, slug = m.group(1), m.group(2)
        if workspace != ALLOWED_WORKSPACE:
            raise ValueError(
                f"Only the '{ALLOWED_WORKSPACE}' workspace is allowed (got '{workspace}')"
            )
        return slug

    # workspace/repo
    m = re.match(r"^([\w-]+)/([\w._-]+)$", url)
    if m:
        workspace, slug = m.group(1), m.group(2)
        if workspace != ALLOWED_WORKSPACE:
            raise ValueError(
                f"Only the '{ALLOWED_WORKSPACE}' workspace is allowed (got '{workspace}')"
            )
        return slug

    # Bare slug — assume metawhale
    m = re.match(r"^[\w._-]+$", url)
    if m:
        return url

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


async def delete_tag(repo_slug: str, tag_name: str) -> dict:
    """Delete a tag. Returns {'deleted': True} on success or if already absent."""
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        resp = await client.delete(_api(f"{repo_slug}/refs/tags/{tag_name}"))
        if resp.status_code in (200, 204):
            return {"deleted": True, "tag": tag_name}
        if resp.status_code == 404:
            return {"deleted": False, "tag": tag_name, "reason": "not found"}
        resp.raise_for_status()
        return {"deleted": False, "tag": tag_name}


async def list_tags(repo_slug: str) -> list[str]:
    """List all tags on a repo. Returns [] on error so callers can treat as 'no info'."""
    try:
        async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
            resp = await client.get(_api(f"{repo_slug}/refs/tags?pagelen=100"))
            resp.raise_for_status()
            return [t["name"] for t in resp.json().get("values", [])]
    except Exception:
        return []


def classify_tags(existing: list[str]) -> dict:
    """Split tag list into bootstrap (ours) and release (real vX.Y.Z) categories."""
    existing_set = set(existing)
    bootstrap_present = sorted(t for t in BOOTSTRAP_TAGS if t in existing_set)
    release_present = sorted(
        t for t in existing
        if t not in BOOTSTRAP_TAGS and _RELEASE_TAG_RE.match(t)
    )
    return {
        "bootstrap": bootstrap_present,
        "release": release_present,
    }
