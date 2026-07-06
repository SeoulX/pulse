"""Per-stage event log for the deploy pipeline.

One doc per (track_token, build_id, stage, state) transition. Written
by the Kafka consumer (services/kafka_events._consume_loop) via the
handler wired in api/handlers/deployments.py. Unique index dedupes
Kafka redeliveries so at-least-once becomes exactly-once at the DB.

Tracker page reads this collection, filters by track_token (per-env
timeline) or joins by submission_id (multi-env grouped view), and
renders one column per attempt.
"""
from datetime import datetime, timezone
from typing import Optional

from beanie import Document, Indexed
from pydantic import Field
from pymongo import ASCENDING, IndexModel


class DeploymentEvent(Document):
    # FK-ish. Not a hard reference — DeploymentRequest lives in a separate
    # collection but they share this token 1:1.
    track_token: Indexed(str)
    submission_id: Optional[str] = None
    deployment_id: str
    slug: str
    env: str

    build_id: Optional[str] = None
    job_id: Optional[str] = None
    attempt: int = 1

    stage: str
    state: str
    error: Optional[str] = None
    tag: Optional[str] = None

    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "deployment_events"
        indexes = [
            # Idempotency: replays of the same (build_id, stage, state) for
            # the same track_token collapse to one row. build_id may be null
            # for pre-build stages so the unique key includes stage+state
            # to avoid nulls-collide-with-nulls surprises.
            IndexModel(
                [
                    ("track_token", ASCENDING),
                    ("build_id", ASCENDING),
                    ("stage", ASCENDING),
                    ("state", ASCENDING),
                ],
                unique=True,
                name="uniq_transition",
            ),
            IndexModel([("submission_id", ASCENDING)]),
        ]
