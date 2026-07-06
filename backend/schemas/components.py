"""Components spec for monorepo / polyworkload deployments.

Source of truth lives at `devops/components.yml` in the customer's repo.
Pulse fetches + parses it during `inspect_repo` so the form can preview
the structure (similar to how devops/workers.yml drives ScaledJob).

Two patterns supported under the same schema, switched by
`image_target` at the spec level:

  Pattern A — multi-image monorepo (sales_crm)
    image_target: per-component   (default)
    Each component declares its own `dockerfile:`. Jenkins builds N
    images (zen0hub/<app>-<component>:<tag>) in parallel.

      image_target: per-component
      components:
        app:
          role: API
          dockerfile: devops/Dockerfile.app
          port: 3000
        frontend:
          role: UI
          dockerfile: devops/Dockerfile.frontend
          port: 80

  Pattern B — single-image polyworkload (saturn-engine)
    image_target: shared
    All components share the repo's default Dockerfile. They differ
    by `command` / `workload_kind` / `schedule` / `replicas`. Jenkins
    builds one image; N manifest trees reference the same tag.

      image_target: shared
      components:
        analyses:
          workload_kind: Deployment
          role: Worker
          replicas: 3
          command: ["python", "-m", "saturn", "run", "kind=analyses"]
        log-pruner:
          workload_kind: CronJob
          schedule: "0 */6 * * *"
          command: ["python", "-m", "saturn", "prune-logs"]

Phase 0 detects the file + surfaces a components summary in the form.
Phases 1-4 wire it through generator + Jenkins + form fan-out.
"""

import re
from typing import Any, Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator


_COMPONENT_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_SUBDOMAIN_RE = re.compile(r"^[a-z][a-z0-9-]*$")
# Five fields × optional second-spec; matches the regex Kubernetes uses
# for CronJob.spec.schedule (rejects most typos at parse time without
# pulling in a full cron parser).
_CRON_RE = re.compile(r"^(\S+\s+){4,5}\S+$")

_ALLOWED_ROLES = {"API", "UI", "Streamlit", "Worker"}
_ALLOWED_WORKLOAD_KINDS = {"Deployment", "Job", "CronJob", "ScaledJob", "StatefulSet"}
_ALLOWED_IMAGE_TARGETS = {"per-component", "shared"}


class ComponentsParseError(ValueError):
    """Raised when devops/components.yml can't be parsed or fails validation."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


class ComponentEntry(BaseModel):
    """One deployable component in a monorepo / polyworkload repo.

    Pattern A: maps 1:1 to a kaniko build (zen0hub/<app>-<component>)
               + a manifest tree (kl-<n>/<app>-<component>/).
    Pattern B: shares the repo image; maps 1:1 to a manifest subtree
               (kl-<n>/<app>/environments/<env>/<component>/).
    """
    name: str
    role: str = "Worker"
    workload_kind: str = Field(default="Deployment", alias="workloadKind")
    # Pattern A: required (per-component dockerfile path).
    # Pattern B: omit — components inherit the repo's shared image.
    dockerfile: Optional[str] = None
    port: int = Field(default=80, ge=1, le=65535)
    needs_ingress: bool = Field(default=False, alias="needsIngress")
    # Optional subdomain override — defaults to the component name when
    # multiple UI components would otherwise collide on <app>.<zone>.
    subdomain: Optional[str] = None
    # Polyworkload knobs (Pattern B). Pattern A can use these too if
    # different commands per dockerfile are desired.
    replicas: int = Field(default=1, ge=0, le=200)
    # `command` overrides the image's CMD/ENTRYPOINT split; `args`
    # appends args to whatever the image runs. Provide one OR the other
    # (rarely both). Lists of strings; recipe matches k8s
    # container.command / container.args semantics.
    command: Optional[List[str]] = None
    args: Optional[List[str]] = None
    # CronJob only — required when workload_kind="CronJob".
    schedule: Optional[str] = None

    model_config = {"populate_by_name": True}

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not _COMPONENT_NAME_RE.match(v):
            raise ValueError(
                f"component name '{v}' must be lowercase "
                f"(letters / digits / dashes only)"
            )
        return v

    @field_validator("subdomain")
    @classmethod
    def _validate_subdomain(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _SUBDOMAIN_RE.match(v):
            raise ValueError(
                f"subdomain '{v}' must be lowercase "
                f"(letters / digits / dashes only)"
            )
        return v

    @field_validator("role")
    @classmethod
    def _validate_role(cls, v: str) -> str:
        if v not in _ALLOWED_ROLES:
            raise ValueError(
                f"role '{v}' must be one of {sorted(_ALLOWED_ROLES)}"
            )
        return v

    @field_validator("workload_kind")
    @classmethod
    def _validate_workload_kind(cls, v: str) -> str:
        if v not in _ALLOWED_WORKLOAD_KINDS:
            raise ValueError(
                f"workload_kind '{v}' must be one of {sorted(_ALLOWED_WORKLOAD_KINDS)}"
            )
        return v

    @field_validator("schedule")
    @classmethod
    def _validate_schedule(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _CRON_RE.match(v.strip()):
            raise ValueError(
                f"schedule '{v}' must be a 5- or 6-field cron expression"
            )
        return v.strip()

    @model_validator(mode="after")
    def _kind_specific_rules(self) -> "ComponentEntry":
        # CronJob requires schedule; non-CronJob must not have schedule.
        if self.workload_kind == "CronJob":
            if not self.schedule:
                raise ValueError(
                    f"component '{self.name}' (CronJob) requires `schedule:`"
                )
        else:
            if self.schedule:
                raise ValueError(
                    f"component '{self.name}' has `schedule:` but workload_kind "
                    f"is {self.workload_kind} — schedule is only for CronJob"
                )
        # Only one of command/args at a time keeps the form simple; the
        # k8s spec supports both, but in practice nobody mixes them.
        if self.command and self.args:
            raise ValueError(
                f"component '{self.name}': set EITHER `command:` OR `args:`, not both"
            )
        return self


class ComponentsSpec(BaseModel):
    """The full monorepo / polyworkload layout for a single deployment."""
    image_target: Literal["per-component", "shared"] = Field(
        default="per-component", alias="imageTarget"
    )
    components: List[ComponentEntry]

    model_config = {"populate_by_name": True}

    @field_validator("components", mode="before")
    @classmethod
    def _coerce_components(cls, v: Any) -> Any:
        """Accept the YAML-friendly dict-of-dicts shape:

            components:
              app:
                role: API
                dockerfile: devops/Dockerfile.app
              frontend:
                role: UI
                dockerfile: devops/Dockerfile.frontend

        OR the explicit list-of-mappings shape (Pydantic's native form).
        """
        if isinstance(v, dict):
            out = []
            for k, body in v.items():
                # Tolerate `frontend: null` — treat as defaults with no fields.
                merged: Dict[str, Any] = {"name": k}
                if isinstance(body, dict):
                    merged.update(body)
                out.append(merged)
            return out
        return v

    @model_validator(mode="after")
    def _validate_structure(self) -> "ComponentsSpec":
        if not self.components:
            raise ValueError("components must list at least one entry")
        seen = set()
        for c in self.components:
            if c.name in seen:
                raise ValueError(f"duplicate component name '{c.name}'")
            seen.add(c.name)
        # Pattern A: every component must declare its dockerfile.
        # Pattern B: dockerfile must NOT be set per component — the
        # repo's shared image (devops/Dockerfile.{staging,prod}) is used.
        if self.image_target == "per-component":
            missing = [c.name for c in self.components if not c.dockerfile]
            if missing:
                raise ValueError(
                    f"image_target=per-component requires `dockerfile:` per "
                    f"component (missing on: {missing})"
                )
        else:  # shared
            extras = [c.name for c in self.components if c.dockerfile]
            if extras:
                raise ValueError(
                    f"image_target=shared forbids per-component `dockerfile:` "
                    f"(remove from: {extras})"
                )
        return self


def parse_components_yaml(yaml_text: str) -> ComponentsSpec:
    """Parse the raw bytes of devops/components.yml into a validated spec.

    Collects validation errors and raises ComponentsParseError so the
    form can surface them all at once rather than one round-trip at a
    time.
    """
    if not yaml_text or not yaml_text.strip():
        raise ComponentsParseError(["devops/components.yml is empty"])

    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as e:
        raise ComponentsParseError([f"YAML parse error: {e}"])

    if not isinstance(data, dict):
        raise ComponentsParseError(
            ["devops/components.yml must be a YAML mapping at the root"]
        )

    try:
        return ComponentsSpec(**data)
    except ValidationError as e:
        errors = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err["loc"])
            errors.append(f"{loc}: {err['msg']}")
        raise ComponentsParseError(errors)
