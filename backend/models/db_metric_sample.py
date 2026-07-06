"""Time-series sample for the Databases observability page.

One doc per (key, captured_at) — written by services/db_sampler.py
every PULSE_DB_SAMPLE_INTERVAL seconds (default 60). The TTL index
on `captured_at` reaps anything older than DATA_RETENTION_DAYS.

Schema is intentionally compact: status + latency + an optional
free-form `metrics` dict for protocol-specific values added later
(e.g. mongo connections, redis used_memory). Frontend reads via
GET /api/databases/history/{key} and charts the time-series.
"""

from datetime import datetime, timezone
from typing import Literal, Optional

from beanie import Document, Indexed
from pydantic import Field

from core.config import settings


class DbMetricSample(Document):
    # `Indexed(... expireAfterSeconds=...)` plus the standard datetime
    # column gives us a Mongo TTL index — no manual cleanup job needed.
    key: str = Indexed()
    kind: str
    captured_at: datetime = Indexed(
        expireAfterSeconds=settings.DATA_RETENTION_DAYS * 86400,
    )

    status: Literal["UP", "DOWN", "DEGRADED"]
    response_time_ms: float = 0.0
    error: Optional[str] = None

    # Optional protocol-specific numeric metrics for charting later
    # (mongo connections, redis used_memory, es heap %, pg backends).
    # Sparse — sampler only sets values it can pull cheaply.
    metrics: dict = Field(default_factory=dict)

    class Settings:
        name = "db_metric_samples"
