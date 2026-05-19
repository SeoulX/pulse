import asyncio
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
      - https://bitbucket.org/metawhale/my_repo/src/main/
      - https://bitbucket.org/metawhale/my_repo/src/main/README.md
      - git@bitbucket.org:metawhale/my_repo.git
      - metawhale/my_repo
      - my_repo (workspace implied as metawhale)
    """
    url = repo_url.strip()

    # URL with workspace (https or SSH); tolerates trailing paths like /src/main/
    m = re.search(r"bitbucket\.org[:/]([\w-]+)/([\w._-]+?)(?:\.git|/|$)", url)
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


# Bitbucket's REST API occasionally 503s for tens of seconds at a time.
# A single transient failure shouldn't kill a deployment submission, so wrap
# the calls in a small exponential-backoff retry. Only retries on 5xx/429 —
# 4xx errors (404s, validation failures) are surfaced immediately so callers
# can branch on them.
async def _retry_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    attempts: int = 3,
    **kwargs,
) -> httpx.Response:
    delay = 0.5
    last: httpx.Response | None = None
    for i in range(attempts):
        try:
            resp = await client.request(method, url, **kwargs)
        except httpx.TransportError:
            # Treat network-level failures the same as 5xx — retry then bubble.
            if i == attempts - 1:
                raise
            await asyncio.sleep(delay)
            delay *= 2
            continue
        if resp.status_code < 500 and resp.status_code != 429:
            return resp
        last = resp
        if i < attempts - 1:
            await asyncio.sleep(delay)
            delay *= 2
    assert last is not None
    return last


async def add_webhook(repo_slug: str) -> dict:
    """Add Jenkins webhook to a Bitbucket repo. Idempotent — skips if exists."""
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Check existing webhooks
        resp = await _retry_request(client, "GET", _api(f"{repo_slug}/hooks"))
        resp.raise_for_status()
        for hook in resp.json().get("values", []):
            if settings.JENKINS_WEBHOOK_URL in hook.get("url", ""):
                return {"skipped": True, "message": "Webhook already exists"}

        # Create webhook
        resp = await _retry_request(
            client,
            "POST",
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
    resp = await _retry_request(client, "GET", _api(repo_slug))
    resp.raise_for_status()
    return resp.json().get("mainbranch", {}).get("name", "main")


async def push_tag(repo_slug: str, tag_name: str) -> dict:
    """Create a lightweight tag on the repo's default branch HEAD."""
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Check if tag already exists
        resp = await _retry_request(
            client, "GET", _api(f"{repo_slug}/refs/tags/{tag_name}")
        )
        if resp.status_code == 200:
            return {"skipped": True, "message": f"Tag {tag_name} already exists"}

        branch = await get_default_branch(client, repo_slug)

        resp = await _retry_request(
            client,
            "POST",
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
        resp = await _retry_request(
            client, "DELETE", _api(f"{repo_slug}/refs/tags/{tag_name}")
        )
        if resp.status_code in (200, 204):
            return {"deleted": True, "tag": tag_name}
        if resp.status_code == 404:
            return {"deleted": False, "tag": tag_name, "reason": "not found"}
        resp.raise_for_status()
        return {"deleted": False, "tag": tag_name}


MANIFESTS_REPO = "manifests-seven-gen-v2"


async def fetch_repo_file(repo_slug: str, path: str) -> str | None:
    """Fetch a single file from the default branch of a Bitbucket repo.
    Returns the file body on 200, None on 404 (file missing) or any error.

    Used by the inspect endpoint to grab `devops/workers.yml` so the form
    can validate the YAML and surface errors before the dev submits.
    """
    try:
        async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
            repo_resp = await _retry_request(client, "GET", _api(repo_slug))
            if repo_resp.status_code != 200:
                return None
            branch = (
                repo_resp.json().get("mainbranch", {}).get("name", "main")
            )
            r = await _retry_request(
                client, "GET", _api(f"{repo_slug}/src/{branch}/{path}")
            )
            return r.text if r.status_code == 200 else None
    except Exception:
        return None
_CLUSTERS_TO_SCAN = ("kl-1", "kl-2")
_ENVS_TO_SCAN = ("staging", "production")

# Any of these in package.json deps/devDeps marks the repo as a UI workload.
# Order doesn't matter — the regex matches the first one present.
_UI_FRAMEWORK_RE = re.compile(
    r'"(next|vite|react-scripts|gatsby|@angular/core|vue|svelte|astro|nuxt|'
    r'@remix-run/react|preact|solid-js)"\s*:'
)


async def _detect_workload(
    client: httpx.AsyncClient,
    repo_slug: str,
    branch: str,
) -> dict:
    """Sniff package manifests to infer (workloadKind, role, team) so the
    form can auto-fill the dev's selections.

    Signals (highest priority first — most specific wins):
    - workers.yaml at root            → ScaledJob (team=DC/ML)
    - requirements.txt has streamlit  → Deployment/Streamlit (team=Backend)
    - package.json has a UI framework → Deployment/UI (team=Frontend).
      Covers next, vite, react-scripts, gatsby, vue, svelte, astro, nuxt,
      angular, remix, preact, solid — i.e. every framework seen across the
      _ui repos in this org.
    - requirements.txt or pyproject.toml has fastapi → Deployment/API
      (team=Backend)

    Returns {} when no signal matches — UI keeps the form's default.
    """
    async def fetch(path: str) -> str | None:
        r = await _retry_request(
            client, "GET", _api(f"{repo_slug}/src/{branch}/{path}")
        )
        return r.text if r.status_code == 200 else None

    async def exists(path: str) -> bool:
        r = await _retry_request(
            client, "GET", _api(f"{repo_slug}/src/{branch}/{path}")
        )
        return r.status_code == 200

    pkg, reqs, pyproject, workers_root, workers_devops, has_static_index = await asyncio.gather(
        fetch("package.json"),
        fetch("requirements.txt"),
        fetch("pyproject.toml"),
        fetch("workers.yaml"),
        fetch("devops/workers.yml"),
        exists("public/index.html"),
        return_exceptions=True,
    )
    pkg = pkg if isinstance(pkg, str) else None
    reqs = reqs if isinstance(reqs, str) else None
    pyproject = pyproject if isinstance(pyproject, str) else None
    workers_root = workers_root if isinstance(workers_root, str) else None
    workers_devops = workers_devops if isinstance(workers_devops, str) else None
    has_static_index = has_static_index is True

    # Either workers.yaml (legacy v1) or devops/workers.yml (v2 spec)
    # indicates a multi-worker ScaledJob layout.
    if workers_root or workers_devops:
        return {
            "inferred_workload_kind": "ScaledJob",
            "inferred_role": None,
            "inferred_team": "DC/ML",
        }
    if reqs and re.search(r"^\s*streamlit", reqs, re.MULTILINE | re.IGNORECASE):
        return {
            "inferred_workload_kind": "Deployment",
            "inferred_role": "Streamlit",
            "inferred_team": "Backend",
        }
    if pkg and _UI_FRAMEWORK_RE.search(pkg):
        return {
            "inferred_workload_kind": "Deployment",
            "inferred_role": "UI",
            "inferred_team": "Frontend",
        }
    has_fastapi = (
        (reqs and re.search(r"^\s*fastapi", reqs, re.MULTILINE | re.IGNORECASE))
        or (pyproject and "fastapi" in pyproject.lower())
    )
    if has_fastapi:
        return {
            "inferred_workload_kind": "Deployment",
            "inferred_role": "API",
            "inferred_team": "Backend",
        }
    # Static-HTML fallback: no Node framework, no Python framework, but a
    # `public/index.html` at the root → it's an nginx-served static UI
    # (covers pulse_test_ui and any plain-HTML production repos).
    if has_static_index and not pkg:
        return {
            "inferred_workload_kind": "Deployment",
            "inferred_role": "UI",
            "inferred_team": "Frontend",
        }
    return {}


async def _manifests_existing_envs(
    client: httpx.AsyncClient,
    repo_slug: str,
) -> dict[str, list[str]]:
    """Return a {cluster: [envs]} map of which envs already have a
    kustomization.yml under <cluster>/<app>/environments/<env>/ in the
    shared manifests repo. Scans both clusters because the dev may not
    know where the app is already deployed — the form disables matching
    env chips on the picked cluster and shows a hint if the app exists
    on the *other* cluster too.
    """
    app = repo_slug.replace("_", "-")

    async def probe(cluster: str, env: str) -> tuple[str, str, bool]:
        path = (
            f"{MANIFESTS_REPO}/src/main/{cluster}/{app}"
            f"/environments/{env}/kustomization.yml"
        )
        r = await _retry_request(client, "GET", _api(path))
        return cluster, env, r.status_code == 200

    results = await asyncio.gather(
        *(
            probe(c, e)
            for c in _CLUSTERS_TO_SCAN
            for e in _ENVS_TO_SCAN
        ),
        return_exceptions=True,
    )
    out: dict[str, list[str]] = {c: [] for c in _CLUSTERS_TO_SCAN}
    for entry in results:
        if isinstance(entry, tuple):
            cluster, env, present = entry
            if present:
                out[cluster].append(env)
    return out


async def inspect_repo(repo_slug: str) -> dict:
    """Check the build-relevant files in a Bitbucket repo + which envs are
    already bootstrapped in manifests-seven-gen-v2 (both kl-1 and kl-2).

    Source-repo checks mirror what Jenkinsfile.default looks for:
    - devops/Dockerfile.staging / devops/Dockerfile.prod — required by the
      default kaniko build steps
    - Jenkinsfile (root) — if present, the default pipeline delegates to
      it and the devops/ requirement no longer applies

    Manifest checks: the form uses `existing_envs` (keyed by cluster) to
    disable env chips for envs that are already in place on the selected
    cluster, and to hint when the app exists on the *other* cluster
    (devs don't always know where it lives).

    Best-effort: on Bitbucket errors, returns existing=True with all flags
    False so the form can surface a generic warning rather than blocking.
    """
    paths = {
        "has_devops": "devops",
        "has_dockerfile_staging": "devops/Dockerfile.staging",
        "has_dockerfile_prod": "devops/Dockerfile.prod",
        "has_jenkinsfile": "Jenkinsfile",
        "has_workers_yml": "devops/workers.yml",
    }
    result: dict = {
        "slug": repo_slug,
        "exists": False,
        "existing_envs": {c: [] for c in _CLUSTERS_TO_SCAN},
        "inferred_workload_kind": None,
        "inferred_role": None,
        "inferred_team": None,
        # When devops/workers.yml exists, the inspect endpoint surfaces a
        # short summary (component+worker counts) so the form can preview
        # the ScaledJob layout before the dev submits. Full validation
        # happens on submit; this is a presence + counts hint only.
        "workers_summary": None,
        **{k: False for k in paths},
    }
    try:
        async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
            repo_resp = await _retry_request(client, "GET", _api(repo_slug))
            if repo_resp.status_code != 200:
                # Source repo missing — still surface any existing
                # manifests so the admin can spot orphaned tree entries.
                result["existing_envs"] = await _manifests_existing_envs(
                    client, repo_slug
                )
                return result
            result["exists"] = True
            branch = (
                repo_resp.json().get("mainbranch", {}).get("name", "main")
            )

            async def check(key: str, path: str) -> tuple[str, bool]:
                r = await _retry_request(
                    client, "GET", _api(f"{repo_slug}/src/{branch}/{path}")
                )
                return key, r.status_code == 200

            tasks: list = [check(k, p) for k, p in paths.items()]
            tasks.append(_manifests_existing_envs(client, repo_slug))
            tasks.append(_detect_workload(client, repo_slug, branch))

            checks = await asyncio.gather(*tasks, return_exceptions=True)
            for entry in checks:
                if isinstance(entry, tuple):
                    key, exists = entry
                    result[key] = exists
                elif isinstance(entry, dict):
                    if "inferred_workload_kind" in entry:
                        # _detect_workload result (empty dict skipped — the
                        # `in` check filters that out implicitly because the
                        # key is only present when a signal matched).
                        result.update(entry)
                    else:
                        # _manifests_existing_envs returns dict[cluster, list[env]]
                        result["existing_envs"] = entry

            # If devops/workers.yml exists, fetch + parse for a summary the
            # form can preview. Failures here are non-fatal — the form just
            # won't show the summary, but submit-time validation will still
            # surface the actual errors.
            if result.get("has_workers_yml"):
                try:
                    r = await _retry_request(
                        client, "GET",
                        _api(f"{repo_slug}/src/{branch}/devops/workers.yml"),
                    )
                    if r.status_code == 200:
                        # Lazy import — avoids a circular dep with schemas.
                        from schemas.workers import (
                            WorkersParseError,
                            parse_workers_yaml,
                        )
                        try:
                            spec = parse_workers_yaml(r.text)
                            worker_count = sum(
                                len(c.workers) for c in spec.components
                            )
                            result["workers_summary"] = {
                                "valid": True,
                                "queue_family": spec.queue_family,
                                "zone": spec.zone,
                                "component_count": len(spec.components),
                                "worker_count": worker_count,
                                "components": [
                                    {"name": c.name, "workers": list(c.workers.keys())}
                                    for c in spec.components
                                ],
                            }
                        except WorkersParseError as e:
                            result["workers_summary"] = {
                                "valid": False,
                                "errors": e.errors,
                            }
                except Exception:
                    # Treat any fetch/parse failure as "no summary"; submit
                    # will re-fetch and surface the real error.
                    pass
    except Exception:
        # Bitbucket flake — leave defaults so the form can show a generic
        # banner rather than blocking on a transient outage.
        pass
    return result


async def list_tags(repo_slug: str) -> list[str]:
    """List all tags on a repo. Returns [] on error so callers can treat as 'no info'."""
    try:
        async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
            resp = await _retry_request(
                client, "GET", _api(f"{repo_slug}/refs/tags?pagelen=100")
            )
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
