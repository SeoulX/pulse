from datetime import datetime
from typing import Optional

from beanie import Document, Indexed
from pydantic import Field


class InfisicalSecretEvent(Document):
    """One row per Infisical secret write (version created).

    Populated by services/infisical_history.py polling
    secret_versions_v2 → secret_folders → project_environments →
    projects. Never stores encryptedValue — Pulse shows WHAT + WHO +
    WHEN, never the new value.
    """

    # Composite natural key so re-polls don't duplicate the same version.
    project_slug: Indexed(str)
    env_slug: Indexed(str)
    secret_key: Indexed(str)
    version: int
    changed_at: Indexed(datetime)
    actor_type: str  # 'user' | 'identity'
    actor: str       # email (users) or identity name
    # Alerts fan-out marker so we don't re-fire on re-runs.
    alert_sent: bool = False

    class Settings:
        name = "infisical_secret_events"
        indexes = [
            [
                ("project_slug", 1),
                ("env_slug", 1),
                ("secret_key", 1),
                ("version", 1),
            ],
        ]

    model_config = {"populate_by_name": True}
