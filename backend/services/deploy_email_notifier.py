"""Email notifications for deploy events.

Fires on `pipeline_callback` when a build lands in a terminal state:
  - completed        → success email
  - failed_build     → failure email w/ log excerpt + Jenkins link
  - failed_manifest  → failure email
  - failed           → failure email (post-build)

Recipient = `deployment.requested_by`. Best-effort — SMTP outage never
raises to the callback; a lost email must not 500 the deploy pipeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

import aiosmtplib

from core.config import settings
from models.deployment import DeploymentRequest

log = logging.getLogger(__name__)

_SUCCESS_STATUSES  = {"completed"}
_FAILURE_STATUSES  = {"failed", "failed_build", "failed_manifest"}
_TERMINAL_STATUSES = _SUCCESS_STATUSES | _FAILURE_STATUSES


def is_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASS)


def _tracker_url(dep: DeploymentRequest) -> str:
    """Build the tracker URL for the deploy record so the email links
    straight into the browser view devs already know."""
    base = getattr(settings, "PULSE_PUBLIC_URL", "") or "http://localhost:3000"
    return f"{base.rstrip('/')}/deploy/track/{dep.track_token}"


def _build_email(dep: DeploymentRequest, status: str,
                 log_excerpt: str | None,
                 jenkins_console_url: str | None) -> MIMEMultipart:
    is_success = status in _SUCCESS_STATUSES
    env = dep.environments[0] if dep.environments else "?"
    tag = getattr(dep, "tag", None) or "?"
    subject_prefix = "✅" if is_success else "❌"
    subject = (
        f"{subject_prefix} Pulse {status} — {dep.repo_slug} "
        f"{tag} ({env} · {dep.cluster})"
    )

    tracker = _tracker_url(dep)
    plain = [
        f"Deployment {status}",
        "",
        f"Repo     : {dep.repo_slug}",
        f"Tag      : {tag}",
        f"Env      : {env}",
        f"Cluster  : {dep.cluster}",
        f"Attempt  : {dep.attempt or 1}",
        f"When     : {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Tracker  : {tracker}",
    ]
    if jenkins_console_url:
        plain.append(f"Jenkins  : {jenkins_console_url}")
    if not is_success and log_excerpt:
        plain.append("")
        plain.append("---- log excerpt ----")
        plain.append(log_excerpt[-3000:])

    accent = "#4ade80" if is_success else "#f87171"
    html = f"""
    <html>
    <body style="font-family: -apple-system, sans-serif; background:#0b0e17; color:#e7e3d8; padding:24px;">
      <div style="max-width:640px; margin:0 auto; background:#10141f; border:1px solid #23283a; border-radius:12px; padding:24px;">
        <div style="font-size:12px; letter-spacing:0.14em; text-transform:uppercase; color:{accent}; font-weight:600;">
          Pulse deploy · {status}
        </div>
        <h1 style="font-family:Georgia,serif; font-size:24px; margin:12px 0 20px; color:#e7e3d8;">
          {dep.repo_slug} <span style="color:{accent}">{tag}</span>
        </h1>
        <table style="font-family:ui-monospace,monospace; font-size:13px; color:#9a9db0;">
          <tr><td style="padding:4px 12px 4px 0;">Env</td><td style="color:#e7e3d8;">{env}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;">Cluster</td><td style="color:#e7e3d8;">{dep.cluster}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;">Attempt</td><td style="color:#e7e3d8;">{dep.attempt or 1}</td></tr>
        </table>
        <div style="margin-top:20px;">
          <a href="{tracker}" style="display:inline-block; background:{accent}; color:#0b0e17; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600; font-size:13px;">Open tracker →</a>
    """
    if jenkins_console_url:
        html += f'<a href="{jenkins_console_url}" style="display:inline-block; margin-left:8px; color:#9a9db0; padding:10px 16px; border-radius:8px; text-decoration:none; font-size:13px; border:1px solid #23283a;">Jenkins log</a>'
    html += "</div>"
    if not is_success and log_excerpt:
        html += f'<pre style="margin-top:20px; background:#0b0e17; border:1px solid #23283a; border-radius:8px; padding:12px; font-size:11px; color:#f87171; overflow:auto; max-height:280px;">{log_excerpt[-3000:]}</pre>'
    html += "</div></body></html>"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = settings.SMTP_FROM
    msg["To"]      = dep.requested_by
    msg.attach(MIMEText("\n".join(plain), "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


async def notify_deploy_result(
    dep: DeploymentRequest,
    status: str,
    log_excerpt: str | None = None,
    jenkins_console_url: str | None = None,
) -> None:
    """Best-effort email dispatch. Never raises."""
    if not is_configured():
        log.info("deploy email skipped — SMTP not configured")
        return
    if status not in _TERMINAL_STATUSES:
        return
    if not dep.requested_by or "@" not in dep.requested_by:
        log.info("deploy email skipped — requested_by missing/invalid: %r",
                 dep.requested_by)
        return
    # Skip only the sentinel fallback for manual_tag records w/ no
    # resolvable Bitbucket author — nothing meaningful to send.
    if dep.requested_by == "jenkins@ci":
        return

    try:
        msg = _build_email(dep, status, log_excerpt, jenkins_console_url)
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=True,
            timeout=15,
        )
        log.info(
            "deploy email sent to %s (repo=%s tag=%s status=%s)",
            dep.requested_by, dep.repo_slug,
            getattr(dep, "tag", "?"), status,
        )
    except Exception:
        log.exception("deploy email dispatch failed")
