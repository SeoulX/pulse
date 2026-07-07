import asyncio
import re
from typing import Optional

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


async def get_branch_head(client: httpx.AsyncClient, repo_slug: str, branch: str) -> Optional[str]:
    """Resolve a branch name to its current commit hash. None if branch missing."""
    resp = await _retry_request(
        client, "GET", _api(f"{repo_slug}/refs/branches/{branch}")
    )
    if resp.status_code != 200:
        return None
    return resp.json().get("target", {}).get("hash")


async def create_branch(repo_slug: str, name: str, from_branch: Optional[str] = None) -> dict:
    """Create a new branch from `from_branch` HEAD (defaults to repo's
    default branch). Idempotent — returns {"skipped": True} when the
    branch already exists, so callers can call unconditionally during
    bootstrap.

    Devs at this org keep `staging` + `main`/`master` per repo; Pulse
    auto-creates `staging` from default when it's missing so the
    tag-from-branch flow always has somewhere to cut from.
    """
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Already exists? short-circuit.
        existing = await get_branch_head(client, repo_slug, name)
        if existing:
            return {"skipped": True, "branch": name, "head": existing}

        source = from_branch or await get_default_branch(client, repo_slug)
        head = await get_branch_head(client, repo_slug, source)
        if not head:
            raise RuntimeError(
                f"can't create branch '{name}' — source branch '{source}' missing on {repo_slug}"
            )
        resp = await _retry_request(
            client, "POST", _api(f"{repo_slug}/refs/branches"),
            json={"name": name, "target": {"hash": head}},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"create_branch failed: HTTP {resp.status_code} {resp.text[:200]}")
        return {"created": True, "branch": name, "from": source, "head": head}


async def push_tag(repo_slug: str, tag_name: str, from_branch: Optional[str] = None) -> dict:
    """Create a lightweight tag at the HEAD of `from_branch` (or the
    repo's default branch when None).

    Per-env tagging: staging deploys tag the `staging` branch HEAD,
    production deploys tag `main`/`master`. Keeps the tag pinned to
    the code the dev actually wanted to ship from that branch instead
    of always cutting from default.
    """
    async with httpx.AsyncClient(auth=_auth(), timeout=15) as client:
        # Check if tag already exists.
        resp = await _retry_request(
            client, "GET", _api(f"{repo_slug}/refs/tags/{tag_name}")
        )
        if resp.status_code == 200:
            return {"skipped": True, "message": f"Tag {tag_name} already exists"}

        branch = from_branch or await get_default_branch(client, repo_slug)
        # Resolve to a real commit hash. Bitbucket's tag endpoint
        # accepts branch names as `target.hash` (auto-resolves), but
        # we resolve up-front to surface a clear error when the branch
        # is missing rather than getting a confusing 400 from the tag
        # create call.
        head = await get_branch_head(client, repo_slug, branch)
        if not head:
            raise RuntimeError(
                f"can't push tag '{tag_name}' — branch '{branch}' missing on {repo_slug}"
            )

        resp = await _retry_request(
            client,
            "POST",
            _api(f"{repo_slug}/refs/tags"),
            json={
                "name": tag_name,
                "target": {"hash": head},
            },
        )
        resp.raise_for_status()
        return {"created": True, "tag": tag_name, "branch": branch, "head": head}


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
_CLUSTERS_TO_SCAN = ("kl-1", "kl-2", "net3")
_ENVS_TO_SCAN = ("staging", "production")

# Any of these in package.json deps/devDeps marks the repo as a UI workload.
# Order matters here — the FIRST match wins, so list specific frameworks
# (next, gatsby, nuxt) ahead of generic builders (vite) ahead of libraries
# (react-scripts), and ahead of view-layer libs (vue, svelte, preact,
# solid-js) which can otherwise shadow the actual framework. We capture
# the matched name and reuse it as `inferred_framework`.
_UI_FRAMEWORK_RE = re.compile(
    r'"(next|nuxt|gatsby|@remix-run/react|astro|@angular/core|'
    r'react-scripts|vite|svelte|vue|preact|solid-js)"\s*:'
)

# Build-output dir + dev/preview port per framework. The deployment
# pipeline uses these to pick the right Dockerfile template + Service
# port. For Next we override based on render_mode (see below).
_FRAMEWORK_DEFAULTS = {
    "next":           {"build_dir": ".next/standalone",   "port": 3000},
    "nuxt":           {"build_dir": ".output",            "port": 3000},
    "gatsby":         {"build_dir": "public",             "port": 80},
    "@remix-run/react": {"build_dir": "build",            "port": 3000},
    "astro":          {"build_dir": "dist",               "port": 80},
    "@angular/core":  {"build_dir": "dist",               "port": 80},
    "react-scripts":  {"build_dir": "build",              "port": 80},
    "vite":           {"build_dir": "dist",               "port": 80},
    "svelte":         {"build_dir": "build",              "port": 80},
    "vue":            {"build_dir": "dist",               "port": 80},
    "preact":         {"build_dir": "dist",               "port": 80},
    "solid-js":       {"build_dir": "dist",               "port": 80},
    "static":         {"build_dir": "public",             "port": 80},
}

# Env-var prefix required by each framework's bundler to expose values to
# client-side code. Pasting `API_URL=foo` for a Vite app silently strips
# it at build time — surfacing the right prefix in the form prevents this
# mystery-bug class entirely.
_FRAMEWORK_ENV_PREFIX = {
    "next":             "NEXT_PUBLIC_",
    "nuxt":             "NUXT_PUBLIC_",
    "vite":             "VITE_",
    "react-scripts":    "REACT_APP_",
    "gatsby":           "GATSBY_",
    "astro":            "PUBLIC_",
    "@remix-run/react": None,        # SSR — full process.env available
    "@angular/core":    None,        # built into environments.ts at compile time
    "svelte":           "VITE_",     # SvelteKit/Vite
    "vue":              "VITE_",
    "preact":           "VITE_",
    "solid-js":         "VITE_",
    "static":           None,
}


def _derive_ui_signals(
    pkg: str | None,
    next_config: str | None,
    *,
    has_pnpm: bool,
    has_yarn: bool,
    has_npm: bool,
    has_bun: bool,
    static_only: bool = False,
) -> dict:
    """Compute fine-grained UI deployment signals.

    Returns the dict slice to merge into `_detect_workload`'s result.
    Caller is responsible for the workload/role/team fields.

    static_only=True is for the `public/index.html` plain-HTML fallback
    where there's no framework — we still surface the static-nginx
    defaults so the form can pre-fill port 80 / no env-prefix.
    """
    if static_only:
        defaults = _FRAMEWORK_DEFAULTS["static"]
        return {
            "inferred_framework": "static",
            "inferred_render_mode": "static",
            "inferred_package_manager": None,
            "inferred_env_prefix": None,
            "inferred_default_port": defaults["port"],
            "inferred_build_output": defaults["build_dir"],
        }

    framework = None
    if pkg:
        m = _UI_FRAMEWORK_RE.search(pkg)
        if m:
            framework = m.group(1)

    # Package manager: lockfile presence — preference order matches what
    # the Dockerfile build template should respect (pnpm > yarn > npm > bun
    # is by lockfile reliability, not popularity).
    if has_pnpm:   pkg_mgr = "pnpm"
    elif has_yarn: pkg_mgr = "yarn"
    elif has_npm:  pkg_mgr = "npm"
    elif has_bun:  pkg_mgr = "bun"
    else:          pkg_mgr = None

    # Next.js render mode: 'export' → static HTML in out/, 'standalone' →
    # minimal SSR server in .next/standalone/, neither → default SSR. Only
    # meaningful for Next today; other frameworks default to their nature.
    render_mode = None
    if framework == "next":
        if next_config and re.search(r"output\s*:\s*['\"]export['\"]", next_config):
            render_mode = "static"
        elif next_config and re.search(r"output\s*:\s*['\"]standalone['\"]", next_config):
            render_mode = "ssr-standalone"
        else:
            render_mode = "ssr-default"
    elif framework in ("nuxt", "@remix-run/react"):
        render_mode = "ssr-default"
    elif framework:
        render_mode = "static"

    defaults = _FRAMEWORK_DEFAULTS.get(framework or "static", _FRAMEWORK_DEFAULTS["static"])
    build_dir = defaults["build_dir"]
    port = defaults["port"]
    # For Next.js with output:'export', it's actually static HTML in out/
    # served by nginx on port 80 — flip from the SSR defaults.
    if framework == "next" and render_mode == "static":
        build_dir = "out"
        port = 80

    return {
        "inferred_framework": framework,
        "inferred_render_mode": render_mode,
        "inferred_package_manager": pkg_mgr,
        "inferred_env_prefix": _FRAMEWORK_ENV_PREFIX.get(framework or "static"),
        "inferred_default_port": port,
        "inferred_build_output": build_dir,
    }


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

    (
        pkg, reqs, pyproject, workers_root, workers_devops, has_static_index,
        nx_js, nx_mjs, nx_ts,
        has_pnpm, has_yarn, has_npm, has_bun,
    ) = await asyncio.gather(
        fetch("package.json"),
        fetch("requirements.txt"),
        fetch("pyproject.toml"),
        fetch("workers.yaml"),
        fetch("devops/workers.yml"),
        exists("public/index.html"),
        # Next.js config can land in any of 3 extensions — fetch all in
        # parallel and use whichever 200s. Cost: 2 extra HEADs on non-Next
        # repos, runs in the same gather() pass so no added latency.
        fetch("next.config.js"),
        fetch("next.config.mjs"),
        fetch("next.config.ts"),
        # Lockfile presence drives package-manager inference.
        exists("pnpm-lock.yaml"),
        exists("yarn.lock"),
        exists("package-lock.json"),
        exists("bun.lockb"),
        return_exceptions=True,
    )
    pkg = pkg if isinstance(pkg, str) else None
    reqs = reqs if isinstance(reqs, str) else None
    pyproject = pyproject if isinstance(pyproject, str) else None
    workers_root = workers_root if isinstance(workers_root, str) else None
    workers_devops = workers_devops if isinstance(workers_devops, str) else None
    has_static_index = has_static_index is True
    next_config = next(
        (c for c in (nx_js, nx_mjs, nx_ts) if isinstance(c, str)),
        None,
    )
    has_pnpm = has_pnpm is True
    has_yarn = has_yarn is True
    has_npm = has_npm is True
    has_bun = has_bun is True

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
            **_derive_ui_signals(
                pkg, next_config,
                has_pnpm=has_pnpm, has_yarn=has_yarn,
                has_npm=has_npm, has_bun=has_bun,
            ),
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
            **_derive_ui_signals(
                None, None,
                has_pnpm=False, has_yarn=False,
                has_npm=False, has_bun=False,
                static_only=True,
            ),
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
        "has_components_yml": "devops/components.yml",
    }
    result: dict = {
        "slug": repo_slug,
        "exists": False,
        "existing_envs": {c: [] for c in _CLUSTERS_TO_SCAN},
        "inferred_workload_kind": None,
        "inferred_role": None,
        "inferred_team": None,
        # UI-specific signals — present on every response (None when the
        # repo isn't a UI) so the form can rely on key existence.
        "inferred_framework": None,
        "inferred_render_mode": None,
        "inferred_package_manager": None,
        "inferred_env_prefix": None,
        "inferred_default_port": None,
        "inferred_build_output": None,
        # When devops/workers.yml exists, the inspect endpoint surfaces a
        # short summary (component+worker counts) so the form can preview
        # the ScaledJob layout before the dev submits. Full validation
        # happens on submit; this is a presence + counts hint only.
        "workers_summary": None,
        # Same idea for devops/components.yml — surfaces the monorepo /
        # polyworkload spec so the form can preview the multi-workload
        # layout (Pattern A or B from schemas/components.py).
        "components_summary": None,
        # Branch presence — devs at this org keep `staging` + `main`/`master`;
        # Pulse cuts tags from staging for staging deploys and from
        # main/master for production. Surfaced here so the form can warn
        # when a branch is missing before submit.
        "default_branch": None,
        "has_staging_branch": False,
        "has_main_branch": False,
        "has_master_branch": False,
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
            result["default_branch"] = branch

            # Branch probes — one HEAD lookup each. Cheap, and the form
            # uses these to warn when the staging branch is missing
            # before the dev submits.
            async def probe_branch(name: str) -> tuple[str, bool]:
                head = await get_branch_head(client, repo_slug, name)
                return name, head is not None

            branch_results = await asyncio.gather(
                probe_branch("staging"),
                probe_branch("main"),
                probe_branch("master"),
                return_exceptions=True,
            )
            for entry in branch_results:
                if isinstance(entry, tuple):
                    name, present = entry
                    result[f"has_{name}_branch"] = present

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

            # Same shape for devops/components.yml (monorepo / polyworkload
            # spec). Failures non-fatal — submit-time validation re-fetches.
            if result.get("has_components_yml"):
                try:
                    r = await _retry_request(
                        client, "GET",
                        _api(f"{repo_slug}/src/{branch}/devops/components.yml"),
                    )
                    if r.status_code == 200:
                        from schemas.components import (
                            ComponentsParseError,
                            parse_components_yaml,
                        )
                        try:
                            spec = parse_components_yaml(r.text)
                            # Group by workload_kind so the form can show
                            # a friendly "3 Deployments + 1 CronJob + 1 StatefulSet" line.
                            kind_counts: dict[str, int] = {}
                            for c in spec.components:
                                kind_counts[c.workload_kind] = kind_counts.get(c.workload_kind, 0) + 1
                            result["components_summary"] = {
                                "valid": True,
                                "image_target": spec.image_target,
                                "component_count": len(spec.components),
                                "kind_counts": kind_counts,
                                "components": [
                                    {
                                        "name":          c.name,
                                        "role":          c.role,
                                        "workload_kind": c.workload_kind,
                                        "replicas":      c.replicas,
                                        "port":          c.port,
                                        "schedule":      c.schedule,
                                        "subdomain":     c.subdomain,
                                        "dockerfile":    c.dockerfile,
                                        "command":       c.command,
                                        "args":          c.args,
                                    }
                                    for c in spec.components
                                ],
                            }
                        except ComponentsParseError as e:
                            result["components_summary"] = {
                                "valid": False,
                                "errors": e.errors,
                            }
                except Exception:
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


async def commit_file(
    repo_slug: str,
    file_path: str,
    file_content: str,
    *,
    message: str,
    author: Optional[str] = None,
    branch: Optional[str] = None,
) -> dict:
    """Commit a single file to the repo's default branch via Bitbucket's
    multipart `/src` endpoint. Returns {'commit': <hash>} on success.

    Bitbucket's API takes the file path as a form-field NAME and the
    file body as its value, with auxiliary fields (`message`, `branch`,
    `author`) alongside. Done as multipart so binary content is safe.
    """
    auth_user = settings.BITBUCKET_USER
    auth_pass = settings.BITBUCKET_APP_PASSWORD
    if not (auth_user and auth_pass):
        raise RuntimeError("BITBUCKET_USER / BITBUCKET_APP_PASSWORD not configured")

    async with httpx.AsyncClient(auth=_auth(), timeout=30) as client:
        target_branch = branch or await get_default_branch(client, repo_slug)

        # httpx multipart: pass `files=` for the file content + `data=` for fields.
        files = {file_path: (file_path, file_content.encode("utf-8"), "text/plain")}
        data = {"message": message, "branch": target_branch}
        if author:
            data["author"] = author

        resp = await _retry_request(
            client, "POST", _api(f"{repo_slug}/src"),
            files=files, data=data,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"commit_file failed: HTTP {resp.status_code} {resp.text[:300]}")
        # Bitbucket returns the new commit hash in the `Location` header for 201.
        loc = resp.headers.get("Location", "")
        commit_hash = loc.rsplit("/", 1)[-1] if loc else ""
        return {"commit": commit_hash, "branch": target_branch}


def next_alpha_tag(existing: list[str]) -> str:
    """Pick the next `vX.Y.Z-alpha` tag based on the highest existing
    alpha. Bumps the patch number. Falls back to `v0.0.1-alpha` when no
    alpha tags exist (we never use v0.0.0-alpha for ongoing work — it's
    reserved for bootstrap)."""
    best: tuple[int, int, int] | None = None
    for t in existing:
        m = re.match(r"^v(\d+)\.(\d+)\.(\d+)-alpha$", t)
        if not m:
            continue
        triple = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if best is None or triple > best:
            best = triple
    if best is None:
        return "v0.0.1-alpha"
    return f"v{best[0]}.{best[1]}.{best[2] + 1}-alpha"


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
