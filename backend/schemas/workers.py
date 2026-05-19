"""Workers spec for ScaledJob deployments.

Source of truth lives at `devops/workers.yml` in the customer's repo.
Pulse fetches + parses it during `inspect_repo` so the form can preview
the structure, and again at submit time so the parsed spec is persisted
on the DeploymentRequest record (Phase 2's generator will consume it).

See manComm/05-14-26/JER-dc-ml-scrapers.md for the full pattern + plan.

Canonical YAML shape:

    queue_family: dc_scrapy        # listName segment 2
    zone: international            # listName segment 4
    components:
      article:                     # listName segment 5
        FIREFOX: {}                # listName segment 6 (defaults applied)
        FIREFOX_PROXY: { max: 40, batch: 10 }
        CHROMIUM: { max: 30 }
        STATIC: { max: 20, batch: 50 }
      section:
        FIREFOX: {}

Pulse computes per worker:
    listName = "{env}:{queue_family}:{project}:{zone}:{component}:{worker_lc}"
"""

import re
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator


_QUEUE_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_COMPONENT_RE = re.compile(r"^[a-z][a-z0-9-]*$")


class WorkersParseError(ValueError):
    """Raised when devops/workers.yml can't be parsed or fails validation.

    `errors` carries a list of human-readable messages so the form can
    show each one inline."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


class WorkerAttrs(BaseModel):
    """Per-worker tuning. Sensible defaults if the YAML omits them."""
    max_replicas: int = Field(default=40, ge=1, le=500, alias="max")
    batch: int = Field(default=10, ge=1, le=10000)
    # Optional explicit Redis listName override. When unset, the generator
    # synthesizes "<env>:<queue_family>:<app>:<zone>:<component>:<worker>".
    # Use this to pin to an existing prod queue (e.g. when migrating a
    # v1 scraper that already has Redis state under a different key).
    list_name: Optional[str] = Field(default=None, alias="listName")

    model_config = {"populate_by_name": True}


class ComponentSpec(BaseModel):
    """One component = one config bucket. Workers under the same component
    share `config.properties` (the kustomize configMapGenerator)."""
    name: str
    workers: Dict[str, WorkerAttrs]

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _COMPONENT_RE.match(v):
            raise ValueError(
                f"component name '{v}' must be lowercase "
                f"(letters / digits / dashes only)"
            )
        return v

    @field_validator("workers")
    @classmethod
    def _validate_worker_names(cls, v: Dict[str, WorkerAttrs]) -> Dict[str, WorkerAttrs]:
        for name in v:
            if not _QUEUE_RE.match(name):
                raise ValueError(
                    f"queue name '{name}' must be UPPERCASE "
                    f"(letters / digits / underscores only)"
                )
        return v


class WorkersSpec(BaseModel):
    """The full ScaledJob layout for a single deployment."""
    queue_family: str = "dc_scrapy"
    zone: str = "international"
    components: List[ComponentSpec]

    @field_validator("components", mode="before")
    @classmethod
    def _coerce_components(cls, v: Any) -> Any:
        """Accept the YAML-friendly dict-of-dicts shape:

            components:
              article:
                FIREFOX: {}
              section:
                FIREFOX: {}

        OR the explicit list-of-mappings shape (Pydantic's native form).
        """
        if isinstance(v, dict):
            return [{"name": k, "workers": (w or {})} for k, w in v.items()]
        return v


def parse_workers_yaml(yaml_text: str) -> WorkersSpec:
    """Parse the raw bytes of devops/workers.yml into a validated spec.

    Collects validation errors and raises WorkersParseError so the form
    can surface them all at once rather than one round-trip at a time.
    """
    if not yaml_text or not yaml_text.strip():
        raise WorkersParseError(["devops/workers.yml is empty"])

    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        raise WorkersParseError([f"YAML parse error: {e}"])

    if not isinstance(data, dict):
        raise WorkersParseError(
            ["devops/workers.yml must be a YAML mapping at the root"]
        )

    try:
        return WorkersSpec(**data)
    except ValidationError as e:
        errors = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err["loc"])
            errors.append(f"{loc}: {err['msg']}")
        raise WorkersParseError(errors)
