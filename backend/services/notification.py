from datetime import datetime, timezone

import httpx

from core.config import settings
from models.endpoint import Endpoint
from models.notification import Notification

RATE_LIMIT_SECONDS = 5 * 60  # 5 minutes


async def process_notifications(endpoint: Endpoint, result: dict) -> None:
    if not endpoint.alert_enabled:
        return

    was_alerting = endpoint.is_alerting
    is_now_up = result["status"] == "UP"

    # Recovery
    if was_alerting and is_now_up:
        await send_to_channels(endpoint, "recovery", result)
        endpoint.is_alerting = False
        await endpoint.save()
        return

    # Alert
    if endpoint.consecutive_failures >= endpoint.alert_threshold and not was_alerting:
        if endpoint.last_alerted_at:
            elapsed = (datetime.now(timezone.utc) - endpoint.last_alerted_at).total_seconds()
            if elapsed < RATE_LIMIT_SECONDS:
                return

        await send_to_channels(endpoint, "alert", result)
        endpoint.is_alerting = True
        endpoint.last_alerted_at = datetime.now(timezone.utc)
        await endpoint.save()


async def send_to_channels(endpoint: Endpoint, notif_type: str, result: dict) -> None:
    message = (
        f"[ALERT] {endpoint.name} is {result['status']} ({endpoint.consecutive_failures} consecutive failures)"
        if notif_type == "alert"
        else f"[RECOVERED] {endpoint.name} is back UP"
    )

    if endpoint.notifications.email.enabled and endpoint.notifications.email.address:
        await send_email(endpoint.notifications.email.address, message, endpoint, notif_type)

    if endpoint.notifications.discord.enabled and endpoint.notifications.discord.webhook_url:
        await send_discord(endpoint.notifications.discord.webhook_url, message, endpoint, result, notif_type)

    if endpoint.notifications.webhook.enabled and endpoint.notifications.webhook.url:
        await send_webhook(endpoint.notifications.webhook.url, endpoint, result, notif_type)


async def send_email(to: str, message: str, endpoint: Endpoint, notif_type: str) -> None:
    try:
        if not settings.SMTP_HOST:
            await log_notification(endpoint, "email", notif_type, "failed", message, "SMTP not configured")
            return

        import aiosmtplib
        from email.mime.text import MIMEText

        msg = MIMEText(
            f"Endpoint: {endpoint.name}\nURL: {endpoint.url}\n"
            f"Status: {endpoint.last_status}\nTime: {datetime.now(timezone.utc).isoformat()}"
        )
        msg["Subject"] = message
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to

        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER or None,
            password=settings.SMTP_PASS or None,
            start_tls=True,
        )
        await log_notification(endpoint, "email", notif_type, "sent", message)
    except Exception as exc:
        await log_notification(endpoint, "email", notif_type, "failed", message, str(exc))


async def send_discord(webhook_url: str, message: str, endpoint: Endpoint, result: dict, notif_type: str) -> None:
    color = 0xFF0000 if notif_type == "alert" else 0x00FF00
    fields = [
        {"name": "Endpoint", "value": endpoint.name, "inline": True},
        {"name": "URL", "value": endpoint.url, "inline": True},
        {"name": "Status", "value": result["status"], "inline": True},
    ]
    if notif_type == "alert":
        fields.append({"name": "Consecutive Failures", "value": str(endpoint.consecutive_failures), "inline": True})

    payload = {
        "embeds": [{
            "title": message,
            "color": color,
            "fields": fields,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }]
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(webhook_url, json=payload)
        await log_notification(endpoint, "discord", notif_type, "sent", message)
    except Exception as exc:
        await log_notification(endpoint, "discord", notif_type, "failed", message, str(exc))


async def send_webhook(url: str, endpoint: Endpoint, result: dict, notif_type: str) -> None:
    payload = {
        "endpoint": endpoint.name,
        "url": endpoint.url,
        "status": result["status"],
        "consecutive_failures": endpoint.consecutive_failures,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "type": notif_type,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload)
        await log_notification(endpoint, "webhook", notif_type, "sent", str(payload))
    except Exception as exc:
        await log_notification(endpoint, "webhook", notif_type, "failed", str(payload), str(exc))


async def log_notification(
    endpoint: Endpoint, channel: str, notif_type: str, status: str, message: str, error: str | None = None
) -> None:
    await Notification(
        endpoint_id=endpoint.id,
        channel=channel,
        type=notif_type,
        status=status,
        message=message,
        error=error,
    ).insert()
