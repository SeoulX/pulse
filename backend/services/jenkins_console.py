"""Jenkins console-log proxy for the tracker's live-tail feature.

Frontend polls Pulse; Pulse fetches Jenkins's progressive log endpoint
and returns just the new bytes since the last poll. Keeps Jenkins auth
out of the browser and adds a natural spot to strip ANSI escapes.

Jenkins job path convention (matches auto-register.xml):
    <base>/job/bitbucket/job/<slug>/job/<tag>/lastBuild
"""
from __future__ import annotations

import re
from typing import Optional

import httpx

from core.config import settings


# Strips ANSI CSI sequences (\x1b[…m and friends). Kaniko, npm, pytest all
# emit these; the terminal renders them as colors but a browser <pre>
# shows raw noise. Applied to every proxied chunk.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def _auth() -> Optional[tuple[str, str]]:
    if not settings.JENKINS_ADMIN_USER or not settings.JENKINS_ADMIN_TOKEN:
        return None
    return (settings.JENKINS_ADMIN_USER, settings.JENKINS_ADMIN_TOKEN)


def _job_base(slug: str, tag: str) -> str:
    """Compute the Jenkins job URL for a multibranch tag build.

    Example:
      slug=pulse_test_api, tag=v0.0.1-alpha ->
      https://jenkins.media-meter.in/job/bitbucket/job/pulse_test_api/job/v0.0.1-alpha
    """
    base = settings.JENKINS_BASE_URL.rstrip("/")
    return f"{base}/job/bitbucket/job/{slug}/job/{tag}"


async def fetch_last_build_number(slug: str, tag: str) -> Optional[int]:
    """Query Jenkins for the most recent build number of a tag job.

    Returns None when the job doesn't exist yet (Bitbucket webhook still
    scanning) or when auth isn't configured. Callers treat None as "no
    log yet — poll again next tick".
    """
    if _auth() is None:
        return None
    url = f"{_job_base(slug, tag)}/api/json?tree=lastBuild[number]"
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=True) as client:
            r = await client.get(url, auth=_auth())
        if r.status_code != 200:
            return None
        data = r.json()
        lb = data.get("lastBuild") or {}
        n = lb.get("number")
        return int(n) if n is not None else None
    except Exception:
        return None


async def fetch_progressive_log(
    slug: str, tag: str, build_number: int, start: int
) -> tuple[str, int, bool]:
    """Fetch the progressiveText slice starting at byte offset `start`.

    Returns (chunk_text, new_offset, more_data). ANSI escapes stripped.
    On any error returns ("", start, False) so the caller can retry
    without losing the offset.
    """
    if _auth() is None:
        return ("", start, False)
    url = (
        f"{_job_base(slug, tag)}/{build_number}/logText/progressiveText"
        f"?start={start}"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=True) as client:
            r = await client.get(url, auth=_auth())
        if r.status_code != 200:
            return ("", start, False)
        text = _ANSI_RE.sub("", r.text or "")
        new_offset = int(r.headers.get("X-Text-Size", start))
        more = (r.headers.get("X-More-Data", "false").lower() == "true")
        return (text, new_offset, more)
    except Exception:
        return ("", start, False)
