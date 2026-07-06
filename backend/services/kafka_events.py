"""Kafka producer + consumer for Pulse deploy event stream.

Topology (created out-of-band in the `kafka` namespace):
  pulse.deploy.jobs      LIST   Jenkins claim queue  (key=track_token)
  pulse.deploy.events    LOG    stage-transition log (key=track_token)
  pulse.deploy.outcomes  LOG    build-completed rows (key=track_token)

Both Pulse and Jenkins produce to `.events`. Pulse consumes it to update
DeploymentRequest.env_statuses + append DeploymentEvent rows. Keying by
track_token puts a per-env stream on one partition = strict order per
env timeline.
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.errors import KafkaError

from core.config import settings

log = logging.getLogger("pulse.kafka")

EVENT_SCHEMA = "pulse.deploy.event.v1"


class _State:
    producer: Optional[AIOKafkaProducer] = None
    consumer_task: Optional[asyncio.Task] = None


def _sasl_kwargs() -> dict[str, Any]:
    """Shared auth kwargs for producer + consumer. Empty when PLAINTEXT."""
    if settings.KAFKA_SECURITY_PROTOCOL == "PLAINTEXT":
        return {}
    return {
        "security_protocol": settings.KAFKA_SECURITY_PROTOCOL,
        "sasl_mechanism": settings.KAFKA_SASL_MECHANISM,
        "sasl_plain_username": settings.KAFKA_SASL_USERNAME,
        "sasl_plain_password": settings.KAFKA_SASL_PASSWORD,
    }


async def start_producer() -> None:
    if _State.producer is not None:
        return
    if not settings.KAFKA_BOOTSTRAP:
        # Explicit opt-out — local dev boxes that can't reach the cluster
        # Kafka set KAFKA_BOOTSTRAP="" so the API boots without spending a
        # full connect timeout on every restart.
        log.info("kafka producer disabled (KAFKA_BOOTSTRAP unset)")
        return
    p = AIOKafkaProducer(
        bootstrap_servers=settings.KAFKA_BOOTSTRAP,
        client_id="pulse-api",
        # Idempotent producer prevents dupes on internal retries. Fine at
        # low-scale (pulse is not a firehose) and gives us exactly-once at
        # the broker for retries within a single producer session.
        enable_idempotence=True,
        acks="all",
        linger_ms=20,
        **_sasl_kwargs(),
    )
    await p.start()
    _State.producer = p
    log.info("kafka producer started bootstrap=%s protocol=%s",
             settings.KAFKA_BOOTSTRAP, settings.KAFKA_SECURITY_PROTOCOL)


async def stop_producer() -> None:
    if _State.producer is not None:
        await _State.producer.stop()
        _State.producer = None


async def _publish(topic: str, key: str, value: dict[str, Any]) -> None:
    if _State.producer is None:
        # Kafka disabled — silently drop. Callers on the deploy hot path
        # already treat publish as best-effort; the alternative is dev
        # boxes spamming stack traces on every callback.
        return
    payload = json.dumps(value, separators=(",", ":")).encode()
    await _State.producer.send_and_wait(topic, value=payload, key=key.encode())


async def enqueue_job(
    *,
    track_token: str,
    submission_id: Optional[str],
    slug: str,
    env: str,
    tag: str,
    requested_by: str,
    deployment_id: str,
) -> str:
    """Publish a build claim onto pulse.deploy.jobs. Returns the job_id."""
    job_id = uuid.uuid4().hex
    payload = {
        "schema": "pulse.deploy.job.v1",
        "job_id": job_id,
        "track_token": track_token,
        "submission_id": submission_id,
        "deployment_id": deployment_id,
        "slug": slug,
        "env": env,
        "tag": tag,
        "requested_by": requested_by,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    await _publish(settings.KAFKA_TOPIC_JOBS, key=track_token, value=payload)
    return job_id


async def publish_event(
    *,
    track_token: str,
    submission_id: Optional[str],
    deployment_id: str,
    slug: str,
    env: str,
    tag: Optional[str],
    stage: str,
    state: str,
    attempt: int,
    build_id: Optional[str],
    job_id: Optional[str],
    error: Optional[str] = None,
) -> None:
    """Publish a stage-transition event onto pulse.deploy.events."""
    payload = {
        "schema": EVENT_SCHEMA,
        "deployment_id": deployment_id,
        "track_token": track_token,
        "submission_id": submission_id,
        "env": env,
        "job_id": job_id,
        "build_id": build_id,
        "attempt": attempt,
        "slug": slug,
        "tag": tag,
        "stage": stage,
        "state": state,
        "ts": datetime.now(timezone.utc).isoformat(),
        "error": error,
    }
    try:
        await _publish(settings.KAFKA_TOPIC_EVENTS, key=track_token, value=payload)
    except KafkaError as exc:
        # Never let a broker hiccup fail an approve/dispatch path. Callers
        # already write to Mongo in the same transaction; the event
        # stream is a fan-out signal, not the source of truth.
        log.warning("kafka publish_event dropped slug=%s env=%s stage=%s err=%s",
                    slug, env, stage, exc)


EventHandler = Callable[[dict[str, Any]], Awaitable[None]]


async def _consume_loop(handler: EventHandler) -> None:
    c = AIOKafkaConsumer(
        settings.KAFKA_TOPIC_EVENTS,
        bootstrap_servers=settings.KAFKA_BOOTSTRAP,
        group_id=settings.KAFKA_CONSUMER_GROUP,
        client_id="pulse-api-consumer",
        # Commit offset only after handler completes = at-least-once. Handler
        # is idempotent via unique (track_token, build_id, stage, state).
        enable_auto_commit=False,
        auto_offset_reset="latest",
        **_sasl_kwargs(),
    )
    await c.start()
    log.info("kafka consumer started topic=%s group=%s",
             settings.KAFKA_TOPIC_EVENTS, settings.KAFKA_CONSUMER_GROUP)
    try:
        async for msg in c:
            try:
                payload = json.loads(msg.value.decode())
                await handler(payload)
                await c.commit()
            except Exception as exc:  # noqa: BLE001
                log.exception("kafka handler failed offset=%s err=%s",
                              msg.offset, exc)
                # Do NOT commit — will redeliver on rebalance / restart.
    finally:
        await c.stop()


def start_consumer(handler: EventHandler) -> None:
    """Fire-and-forget consumer task. Cancelled at shutdown."""
    if _State.consumer_task is not None and not _State.consumer_task.done():
        return
    _State.consumer_task = asyncio.create_task(_consume_loop(handler))


async def stop_consumer() -> None:
    if _State.consumer_task is not None:
        _State.consumer_task.cancel()
        try:
            await _State.consumer_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _State.consumer_task = None
