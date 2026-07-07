"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { mutate } from "swr";
import {
  Rocket,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  Lock,
} from "lucide-react";
import { useAuth } from "@/components/auth-context";

const ALLOWED_WORKSPACE = "metawhale";

function validateWorkspace(input: string): string | null {
  const v = input.trim();
  if (!v) return "Repo is required.";
  const urlMatch = v.match(/bitbucket\.org[:/]([\w-]+)\//);
  if (urlMatch && urlMatch[1] !== ALLOWED_WORKSPACE) {
    return `Only '${ALLOWED_WORKSPACE}' workspace is allowed (got '${urlMatch[1]}').`;
  }
  const slashMatch = v.match(/^([\w-]+)\/[\w._-]+$/);
  if (slashMatch && slashMatch[1] !== ALLOWED_WORKSPACE) {
    return `Only '${ALLOWED_WORKSPACE}' workspace is allowed (got '${slashMatch[1]}').`;
  }
  return null;
}

// Mirrors parse_repo_slug on the backend so the form can show the derived
// slug + path live, without a roundtrip. Anchored at `metawhale/` so URLs
// that deep-link inside a repo (e.g. .../metawhale/foo/admin/webhooks) still
// resolve to `foo` rather than the trailing page slug.
function deriveSlug(repoUrl: string): { slug: string; valid: "good" | "warn" | null } {
  const v = repoUrl.trim();
  if (!v) return { slug: "", valid: null };
  let raw: string | null = null;
  const wsMatch = v.match(/metawhale\/([a-zA-Z0-9._-]+?)(?:\.git)?(?:[/?#]|$)/);
  if (wsMatch) raw = wsMatch[1];
  if (!raw) {
    // Fallback for bare slugs the dev typed (no `metawhale/` prefix yet).
    const tail = v.match(/([a-zA-Z0-9_-]+?)(?:\.git)?\/?$/);
    raw = tail ? tail[1] : v;
  }
  const slug = raw.toLowerCase();
  const valid = /^[a-z][a-z0-9_-]*$/.test(slug) ? "good" : "warn";
  return { slug, valid };
}

const WORKLOAD_KINDS = [
  { value: "Deployment", label: "Deployment" },
  { value: "StatefulSet", label: "StatefulSet" },
  { value: "ScaledJob", label: "ScaledJob" },
  { value: "CronJob", label: "CronJob" },
] as const;

const KIND_HINTS: Record<string, string> = {
  Deployment: "Stateless replicas — APIs, UIs, most workers.",
  StatefulSet: "Stable identity + per-replica PVC — DBs, brokers.",
  ScaledJob: "KEDA jobs that scale per queue/event — scrapers.",
  CronJob: "Time-scheduled, runs to completion.",
};

const ROLES = [
  { value: "API", label: "API" },
  { value: "UI", label: "UI" },
  { value: "Streamlit", label: "Streamlit" },
  { value: "Worker", label: "Worker" },
] as const;

const ROLE_DEFAULT_PORT: Record<string, number> = {
  API: 8000,
  UI: 3000,
  Streamlit: 8501,
  Worker: 8000,
};

// Keys already injected into every pod via the cluster-wide
// `devops-global-secrets` Secret (Reflector-mirrored into every
// namespace). Devs should NOT paste these into the env-vars textarea —
// the secret takes precedence over the configMap and the dev's value
// would be silently overridden. Source of truth lives in the cluster:
//   kubectl --context <ctx> get secret -n global devops-global-secrets
// When that key list changes, mirror the update here so the form
// warning stays accurate.
const GLOBAL_INJECTED_KEYS: readonly string[] = [
  "MONGODB_URI",
  "REDIS_NET4_URI",
  "REDIS_KL_V4_URI",
  "REDIS_KL_MAIN_URI",
  "ES_SCOUP_URI",
  "ES_V4_URI",
  "ES_SALINA_URI",
  "ES_VP_URI",
  "POSTGRES_URI",
  "MINIO_ACCESS_KEY_ID",
  "MINIO_SECRET_ACCESS_KEY",
  "MINIO_ENDPOINT_URL",
];

const ROLE_HINTS: Record<string, string> = {
  API: "HTTP server, service + ingress + cert + HPA.",
  UI: "Static frontend. Service + ingress, no envFrom.",
  Streamlit: "Dashboard on :8501 with session affinity.",
  Worker: "Queue consumer. No service, env-only inputs.",
};

const TEAMS = [
  { value: "Backend", label: "Backend" },
  { value: "Frontend", label: "Frontend" },
  { value: "DC/ML", label: "DC/ML" },
] as const;

const CLUSTERS = ["kl-1", "kl-2", "net3"] as const;

const ENVIRONMENTS = [
  { value: "staging", label: "staging", tag: "v0.0.0-alpha" },
  { value: "production", label: "production", tag: "v0.0.0" },
] as const;

// All public Route53 hosted zones across both AWS profiles
// (default + aws-mmi-drian). Synced 2026-05-14 — see
// manifests-seven-gen-v2/manComm/05-14-26/route53-backup/ for the raw
// record dump captured before any external-dns writes against these zones.
const DOMAIN_ZONES = [
  "media-meter.in",
  "amin-apac.com",
  "bebot.page",
  "buboy.ai",
  "buboy.page",
  "detour.run",
  "dividr.app",
  "downlodr.com",
  "dyaryo.ai",
  "essuances.com",
  "kersiv.ai",
  "kurii.ai",
  "lexibean.ai",
  "m2comms.com",
  "m2comms.net",
  "m2online.ph",
  "media-meter.com",
  "media-meter.net",
  "media-meter.org",
  "metawhale.app",
  "morfd.ai",
  "mycelium-learn.com",
  "rythmosdb.com",
  "rythmosdb.io",
  "salin.ai",
  "salina.app",
  "salina.chat",
  "salina.page",
  "scoup.app",
  "sekond.io",
  "seven-gen.com",
  "seven-gen.net",
  "skedulosa.app",
  "talisik.ai",
  "talisik.com",
  "temportia.ai",
  "torni.ai",
  "twygr.ai",
  "whizpen.ai",
] as const;

type WorkloadKind = (typeof WORKLOAD_KINDS)[number]["value"];
type Role = (typeof ROLES)[number]["value"];
type Team = (typeof TEAMS)[number]["value"];
type Cluster = (typeof CLUSTERS)[number];
type Environment = (typeof ENVIRONMENTS)[number]["value"];
type DomainZone = (typeof DOMAIN_ZONES)[number];

const inputClass =
  "w-full rounded-xl border bg-background px-3.5 py-2 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#fbbf24] dark:focus:ring-[#fbbf24]/20";

// Accent-tinted variant for the top "who/where" row — gives the three primary
// inputs a soft brand-color fill so they read as the entry points of the form.
const inputAccentClass =
  "w-full rounded-xl border border-[#e8871e]/30 bg-[#e8871e]/10 px-3.5 py-2 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:border-[#fbbf24]/30 dark:bg-[#fbbf24]/10 dark:focus:border-[#fbbf24] dark:focus:ring-[#fbbf24]/20";

const pillBase =
  "rounded-xl border px-3 py-1.5 text-sm font-medium transition-all";
const pillActive =
  "border-[#e8871e] bg-[#e8871e]/10 text-[#c2410c] dark:border-[#fbbf24] dark:bg-[#fbbf24]/10 dark:text-[#fbbf24]";
const pillIdle = "border-border hover:bg-muted";
const pillDisabled = "border-border opacity-50 cursor-not-allowed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubmittedDeployment {
  _id: string;
  repoSlug: string;
  team: string;
  workloadKind: string;
  role: string | null;
  cluster: string;
  environments: string[];
  envVars?: Record<string, string>;
  domain?: string | null;
  manifestPath?: string;
  status: string;
  error?: string | null;
  // Per-env pipeline status. Each requested env carries its own progress so
  // a completed prod doesn't visually mask a failed staging.
  envStatuses?: Record<string, string>;
  envErrors?: Record<string, string>;
  // Cluster-aware ArgoCD UI link per env. Shown once the env hits "completed".
  argocdLinks?: Record<string, string>;
  requestedBy: string;
  createdAt: string;
  trackToken?: string;
  trackUrl?: string;
}

interface WorkersSummary {
  valid: boolean;
  errors?: string[];
  queue_family?: string;
  zone?: string;
  component_count?: number;
  worker_count?: number;
  components?: { name: string; workers: string[] }[];
}

interface RepoInspection {
  slug: string;
  exists: boolean;
  has_devops: boolean;
  has_dockerfile_staging: boolean;
  has_dockerfile_prod: boolean;
  has_jenkinsfile: boolean;
  has_workers_yml: boolean;
  has_components_yml: boolean;
  // {cluster: envs-already-bootstrapped}. Scanned across both kl-1 and
  // kl-2 so the form can warn even when the dev picks the "empty" cluster
  // unaware that the app already lives on the other.
  existing_envs: Record<string, string[]>;
  // Sniffed from package.json / requirements.txt / pyproject.toml /
  // workers.yaml — null when no clear signal.
  inferred_workload_kind: string | null;
  inferred_role: string | null;
  inferred_team: string | null;
  // UI-deployment signals — sniffed from package.json + next.config + lockfiles.
  // Drive port auto-fill, env-prefix validation, and the Dockerfile-template
  // hint banner. All null when the repo isn't a UI workload.
  inferred_framework: string | null;          // next | vite | react-scripts | gatsby | ...
  inferred_render_mode: string | null;        // static | ssr-default | ssr-standalone
  inferred_package_manager: string | null;    // npm | yarn | pnpm | bun
  inferred_env_prefix: string | null;         // NEXT_PUBLIC_ | VITE_ | REACT_APP_ | ...
  inferred_default_port: number | null;       // 80 (nginx) / 3000 (SSR) / 4173 (vite preview)
  inferred_build_output: string | null;       // .next/standalone | out | dist | build | public
  // Present when devops/workers.yml exists. Parsed at inspect time so the
  // form can show the dev exactly what was found before they hit submit.
  workers_summary: WorkersSummary | null;
  // Present when devops/components.yml exists (monorepo / polyworkload).
  // Mirrors workers_summary shape; surfaces the multi-kind layout for
  // pre-submit preview.
  components_summary: ComponentsSummary | null;
}

interface ComponentsSummary {
  valid: boolean;
  image_target?: "per-component" | "shared";
  component_count?: number;
  kind_counts?: Record<string, number>;
  components?: Array<{
    name: string;
    role: string;
    workload_kind: string;
    replicas: number;
    port: number;
    schedule: string | null;
    subdomain: string | null;
    dockerfile: string | null;
    command: string[] | null;
    args: string[] | null;
  }>;
  errors?: string[];
}

interface DeploymentFormProps {
  onSubmitted?: (dep: SubmittedDeployment) => void;
}

function LockedChip({ note }: { note: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <Lock className="h-2.5 w-2.5" /> {note}
    </span>
  );
}

export function DeploymentForm({ onSubmitted }: DeploymentFormProps = {}) {
  const { user } = useAuth();
  const [requestedBy, setRequestedBy] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [team, setTeam] = useState<Team>("Backend");
  const [workloadKind, setWorkloadKind] = useState<WorkloadKind>("Deployment");
  const [role, setRole] = useState<Role>("API");
  const [withWorker, setWithWorker] = useState(false);
  const [cluster, setCluster] = useState<Cluster>("kl-1");
  const [environments, setEnvironments] = useState<Environment[]>(["staging"]);
  const [envVarsStaging, setEnvVarsStaging] = useState("");
  const [envVarsProduction, setEnvVarsProduction] = useState("");
  const [domain, setDomain] = useState("");
  const [overrideHost, setOverrideHost] = useState(false);
  const [domainZone, setDomainZone] = useState<DomainZone>("media-meter.in");
  const [port, setPort] = useState(8000);
  const [showFrontendEnv, setShowFrontendEnv] = useState(false);
  const [activeEnvTab, setActiveEnvTab] = useState<Environment>("staging");
  // Ingress is opt-in / opt-out — defaults to true for role=API/UI/Streamlit,
  // false for Worker/ScaledJob/CronJob. Tracked separately from role so the
  // user can override either way after picking a role.
  const [needsIngress, setNeedsIngress] = useState(false);
  const [ingressTouched, setIngressTouched] = useState(false);
  // Infisical scope bootstrap — checked by default (org convention is
  // Infisical-managed secrets on every new repo). Devs uncheck for
  // internal-only workloads that don't need a scoped secret store.
  const [secretsEnabled, setSecretsEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // SEV: a single form submit can create N records (one per env). We keep
  // the array so the success card can show a tracker URL for each sibling.
  const [lastSubmitted, setLastSubmitted] = useState<SubmittedDeployment[] | null>(
    null
  );
  const [lastConflictStrategy, setLastConflictStrategy] = useState<
    string | null
  >(null);
  // Bump-on-click trigger for the "Refresh" button next to the repo
  // URL — re-runs inspect without a full page reload. Dev pushes
  // devops/components.yml + clicks refresh to flip the amber banner
  // to green.
  const [refreshTick, setRefreshTick] = useState(0);
  const [repoInspection, setRepoInspection] = useState<RepoInspection | null>(
    null
  );
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => {
    if (user?.email && !requestedBy) setRequestedBy(user.email);
  }, [user?.email, requestedBy]);

  const isDeployment = workloadKind === "Deployment";
  const isFrontend = team === "Frontend";
  const isDcMl = team === "DC/ML";
  // ScaledJob = multi-worker (Phase 1). Team is no longer the lock (Phase 0
  // decision); workloadKind alone determines whether the workers section
  // shows.
  const isScaledJob = workloadKind === "ScaledJob";
  // Kept under the legacy name for the existing render branches that gate
  // on it. Same value as isScaledJob now.
  const isMultiWorker = isScaledJob;
  const envsDisabled = environments.length === 0;
  // ScaledJob: env_vars textarea stays visible because the parent
  // (L3 component) config.properties needs the shared REDIS_*, BASE_URL,
  // PROXY_URI etc. — same content gets copied into every component's
  // config.properties by Phase 2's generator. (Verified by diffing v1
  // scoup/scrapy article vs section configs — identical content.)
  const envRequired = !isFrontend;
  const envVisible = !isFrontend || showFrontendEnv;
  const stagingPicked = environments.includes("staging");
  const productionPicked = environments.includes("production");
  const portUsed = isDeployment && role !== "Worker" && !isMultiWorker;
  // Ingress UI is gated on three things: a Deployment workload, not a
  // multi-worker / ScaledJob, AND the user-controlled "Needs public ingress"
  // checkbox being on. Unchecking the box removes the DNS zone selector,
  // host-override field, and host-preview rows below.
  const domainUsed = isDeployment && !isMultiWorker && needsIngress;
  const roleVisible = isDeployment && !isMultiWorker;

  // Team is a label only — it doesn't cascade into role/workload anymore.
  // Locks now live entirely at the role level (see role-lock effect below).
  // We still reset showFrontendEnv when leaving Frontend so the runtime
  // env-var checkbox doesn't leave stale state in a non-Frontend submission.
  useEffect(() => {
    if (!isFrontend) setShowFrontendEnv(false);
  }, [isFrontend]);

  // Default container port from the inspect signal when available (Next.js
  // SSR needs 3000, not the role's default 80), else from the role.
  // Inspect-driven default is the more accurate signal — for UIs especially,
  // since the role doesn't distinguish nginx-static from Node-SSR. Falls
  // back to the role default when the inspect didn't return a port (e.g.
  // non-UI workloads).
  useEffect(() => {
    const inferred = repoInspection?.inferred_default_port;
    if (typeof inferred === "number" && inferred > 0) {
      setPort(inferred);
      return;
    }
    const portDef = ROLE_DEFAULT_PORT[role];
    if (portDef) setPort(portDef);
  }, [role, repoInspection?.inferred_default_port]);

  // needsIngress starts OFF by design. Devs opt in explicitly rather
  // than getting a role-based auto-check that they'd have to un-tick
  // for internal-only workloads. The old role → auto-check effect
  // was removed 2026-07-06 per form redesign.

  // Roles that are HTTP servers → always Deployment. (UI is also in this
  // set but the Frontend team lock already handles it; listing it here is
  // belt-and-braces in case the form ever lets UI escape Frontend team.)
  // Worker is intentionally not in this set — workers can legitimately be
  // Deployment / ScaledJob / CronJob depending on the trigger pattern.
  useEffect(() => {
    const deploymentOnly = role === "API" || role === "UI" || role === "Streamlit";
    if (deploymentOnly && workloadKind !== "Deployment") {
      setWorkloadKind("Deployment");
    }
  }, [role, workloadKind]);

  // Keep activeEnvTab pointing at a picked env so the textarea is always
  // showing something the user actually selected.
  useEffect(() => {
    if (!environments.includes(activeEnvTab) && environments.length > 0) {
      setActiveEnvTab(environments[0]);
    }
  }, [environments, activeEnvTab]);

  // Scan the Bitbucket repo for devops/Dockerfile.* and Jenkinsfile so we
  // can block submission early when the default pipeline would fail at
  // build time. Debounced so a typing user doesn't hammer Bitbucket's API.
  // (deriveSlug runs again at line ~335 — cheap pure fn, kept colocated
  // with each consumer for readability.)
  const inspectSlug = deriveSlug(repoUrl);
  useEffect(() => {
    if (inspectSlug.valid !== "good") {
      setRepoInspection(null);
      setInspecting(false);
      return;
    }
    let cancelled = false;
    setInspecting(true);
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/deployments/inspect/${inspectSlug.slug}`
        );
        if (cancelled) return;
        if (res.ok) {
          setRepoInspection((await res.json()) as RepoInspection);
        } else {
          setRepoInspection(null);
        }
      } catch {
        if (!cancelled) setRepoInspection(null);
      } finally {
        if (!cancelled) setInspecting(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inspectSlug.slug, inspectSlug.valid, refreshTick]);

  const toggleEnv = (env: Environment) => {
    setEnvironments((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]
    );
  };

  // Live derivations the footer + host preview consume.
  const { slug, valid: slugValid } = deriveSlug(repoUrl);
  // The repo slug can contain underscores (e.g. `pulse_test_streamlit`), but
  // K8s names + DNS-1123 hosts can't. Jenkins normalizes to dashes for the
  // `app` field in spec.json, so the preview mirrors that.
  const appName = slug.replace(/_/g, "-");

  // Repos with their own Jenkinsfile control their own build and bypass the
  // default pipeline's devops/ requirement. Otherwise we need both Dockerfiles
  // present (Jenkins errors at build time if either is missing for the
  // matching tag pattern). Only treat the check as authoritative once we
  // have a successful inspection result.
  const repoBlockReason: string | null = (() => {
    if (!repoInspection || repoInspection.has_jenkinsfile) return null;
    if (!repoInspection.exists) return "Repo not found in the metawhale workspace.";
    const missing: string[] = [];
    if (!repoInspection.has_devops) missing.push("devops/");
    if (!repoInspection.has_dockerfile_staging)
      missing.push("devops/Dockerfile.staging");
    if (!repoInspection.has_dockerfile_prod)
      missing.push("devops/Dockerfile.prod");
    return missing.length
      ? `Repo is missing: ${missing.join(", ")}.`
      : null;
  })();

  // Pulse-align REQUIRED (2026-06-16). Every Pulse-managed repo must
  // declare devops/components.yml (or devops/workers.yml for ScaledJob
  // multi-worker repos). Without one, the polyworkload generator
  // doesn't fire + the form has no workload shape to read. Block
  // submit until the dev runs /pulse-align, commits, and pushes.
  const specBlockReason: string | null = (() => {
    if (!repoInspection || repoInspection.has_jenkinsfile) return null;
    if (!repoInspection.exists) return null; // covered by repoBlockReason
    if (repoInspection.has_components_yml || repoInspection.has_workers_yml) return null;
    return "Repo needs devops/components.yml — run /pulse-align in the repo.";
  })();

  // Find the cluster the repo is already bootstrapped on (if any). We lock
  // the form to that cluster so the dev can't accidentally pick the wrong
  // one — re-bootstrapping into a parallel cluster is almost never intended.
  const deployedClusterEntries = repoInspection?.existing_envs
    ? Object.entries(repoInspection.existing_envs).filter(
        ([, envs]) => envs.length > 0
      )
    : [];
  // Single deployed cluster → lock the picker to it. Two clusters with
  // existing manifests is rare (mid-migration) — surface the situation in
  // a banner but don't auto-lock since either is plausible.
  const lockedCluster: Cluster | null =
    deployedClusterEntries.length === 1
      ? (deployedClusterEntries[0][0] as Cluster)
      : null;
  const existingEnvsHere: string[] =
    repoInspection?.existing_envs?.[cluster] ?? [];
  const missingEnvsHere: Environment[] = ENVIRONMENTS.map((e) => e.value).filter(
    (e) => !existingEnvsHere.includes(e)
  );

  // When a single cluster is locked, snap form state to match: jump to that
  // cluster and auto-select only the envs that still need bootstrapping.
  useEffect(() => {
    if (!repoInspection) return;
    if (lockedCluster && cluster !== lockedCluster) {
      setCluster(lockedCluster);
      return; // wait for cluster change to re-trigger this effect
    }
    if (existingEnvsHere.length > 0) {
      setEnvironments(missingEnvsHere);
    }
    // Keying on the JSON-stringified existing_envs collapses repeated polls
    // with identical results into a single state update.
  }, [JSON.stringify(repoInspection?.existing_envs ?? {}), cluster]);

  // Auto-fill workload kind / role / team from the sniffed repo signals.
  // The existing team-lock effect handles the cascade (Frontend → forces
  // Deployment/UI, DC/ML → forces ScaledJob), so setting team first is
  // sufficient; we still set workloadKind/role explicitly for the Backend
  // case where the team-lock leaves those alone.
  useEffect(() => {
    if (!repoInspection) return;
    if (repoInspection.inferred_team) {
      setTeam(repoInspection.inferred_team as Team);
    }
    if (repoInspection.inferred_workload_kind) {
      setWorkloadKind(repoInspection.inferred_workload_kind as WorkloadKind);
    }
    // For ScaledJob the backend returns inferred_role=null. Force role to
    // "Worker" so the role-lock effect doesn't snap workloadKind back to
    // "Deployment" (only API/UI/Streamlit trigger the snap). For other
    // inferences, only set role if the backend told us what it should be.
    if (repoInspection.inferred_role) {
      setRole(repoInspection.inferred_role as Role);
    } else if (repoInspection.inferred_workload_kind === "ScaledJob") {
      setRole("Worker");
    }
    // DC/ML scrapers live on kl-2 by convention. Snap the cluster picker
    // when a workers.yml-bearing repo lands so the dev doesn't have to
    // remember. The cluster-lock effect (downstream) only overrides if
    // the repo is already bootstrapped elsewhere — that path still wins.
    if (repoInspection.inferred_workload_kind === "ScaledJob") {
      setCluster("kl-2");
    }
  }, [
    repoInspection?.inferred_team,
    repoInspection?.inferred_workload_kind,
    repoInspection?.inferred_role,
  ]);

  // Mirror common.sh load_env_defaults: production uses the base host as-is;
  // staging splices `-staging` into the leftmost label. The override field
  // stores the production-style host; staging auto-derives from it.
  const hostFor = (env: Environment): string => {
    if (!appName) return "";
    const base = overrideHost && domain.trim() ? domain.trim() : `${appName}.${domainZone}`;
    if (env === "production") return base;
    const dot = base.indexOf(".");
    if (dot === -1) return `${base}-staging`;
    return `${base.slice(0, dot)}-staging.${base.slice(dot + 1)}`;
  };
  const previewHosts = environments
    .filter((e): e is Environment => e === "staging" || e === "production")
    .map((e) => ({ env: e, host: hostFor(e) }));

  // Team no longer filters roles/kinds — picker stays free so users can
  // re-tag without losing their workload selection. Only role-based locks
  // remain authoritative.
  const availableRoles = ROLES;
  const roleLocksToDeploy =
    role === "API" || role === "UI" || role === "Streamlit";
  // Show ALL workload kinds always; non-Deployment pills get disabled when
  // role locks to Deployment so the user sees the constraint instead of
  // wondering where the other pills went.
  const availableKinds = WORKLOAD_KINDS;

  const resetForm = () => {
    setRepoUrl("");
    setTeam("Backend");
    setWorkloadKind("Deployment");
    setRole("API");
    setWithWorker(false);
    setCluster("kl-1");
    setEnvironments(["staging"]);
    setActiveEnvTab("staging");
    setEnvVarsStaging("");
    setEnvVarsProduction("");
    setDomain("");
    setOverrideHost(false);
    setDomainZone("media-meter.in");
    setPort(8000);
    setShowFrontendEnv(false);
    setLastSubmitted(null);
    setLastConflictStrategy(null);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLastSubmitted(null);
    if (!EMAIL_RE.test(requestedBy.trim())) {
      setError("Enter a valid email.");
      return;
    }
    const wsError = validateWorkspace(repoUrl);
    if (wsError) {
      setError(wsError);
      return;
    }
    if (envsDisabled) {
      setError("Pick at least one environment.");
      return;
    }
    if (envRequired) {
      if (stagingPicked && !envVarsStaging.trim()) {
        setError(`Staging env vars are required for ${team}.`);
        return;
      }
      if (productionPicked && !envVarsProduction.trim()) {
        setError(`Production env vars are required for ${team}.`);
        return;
      }
    }
    // ScaledJob gate: workers.yml must exist in devops/ and parse. The
    // inspect endpoint surfaces this in repoInspection.workers_summary;
    // we just check `valid`. The submit-time fetch in the backend is the
    // authoritative validation — this is just an early-block hint.
    if (
      isScaledJob &&
      (!repoInspection?.has_workers_yml ||
        repoInspection?.workers_summary?.valid === false)
    ) {
      setError(
        "ScaledJob needs a valid devops/workers.yml in the repo. " +
        "See the workers summary above the repo field for details."
      );
      return;
    }
    setLoading(true);

    const envVarsPayload: Record<string, string> = {};
    if (stagingPicked && envVarsStaging.trim()) envVarsPayload.staging = envVarsStaging;
    if (productionPicked && envVarsProduction.trim()) envVarsPayload.production = envVarsProduction;

    try {
      const res = await apiFetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          requested_by: requestedBy.trim(),
          team,
          workload_kind: workloadKind,
          role: isMultiWorker ? null : isDeployment ? role : null,
          with_worker: role === "API" && withWorker && !isMultiWorker,
          cluster,
          environments,
          env_vars: envVarsPayload,
          domain: overrideHost && domain.trim() ? domain.trim() : null,
          domain_zone: domainZone,
          port,
          // ScaledJob never gets an ingress — workers are queue-driven.
          // Force false on submit so a stale form-state default can't slip
          // through and trigger an ingress + cert that nothing routes to.
          needs_ingress: isScaledJob ? false : needsIngress,
          secrets_enabled: secretsEnabled,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : data.detail?.message ?? "Failed to submit deployment"
        );
      }

      const data = await res.json();
      // SEV: API now returns an array (one record per env). Coerce legacy
      // single-object responses to a 1-item array for forward compat.
      const records: SubmittedDeployment[] = Array.isArray(data)
        ? data
        : [data];
      records.forEach((r) => onSubmitted?.(r));
      setLastSubmitted(records);
      setLastConflictStrategy(
        (records[0] as unknown as { planned?: { conflict_strategy?: string } })
          ?.planned?.conflict_strategy ?? null
      );
      mutate("/api/deployments");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (lastSubmitted && lastSubmitted.length > 0) {
    return (
      <SuccessCard
        submitted={lastSubmitted}
        conflictStrategy={lastConflictStrategy}
        onSubmitAnother={resetForm}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {repoBlockReason && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">Build files missing</div>
            <div className="text-xs">
              {repoBlockReason} The default Jenkins pipeline needs both
              Dockerfiles, or commit a root <code className="rounded bg-amber-100 px-1 font-mono text-[11px] dark:bg-amber-900/40">Jenkinsfile</code>{" "}
              to override.
            </div>
          </div>
        </div>
      )}

      {/* ScaledJob: surface devops/workers.yml status. Block submission
          when the file's missing or fails validation. */}
      {isScaledJob && repoInspection && (
        repoInspection.has_workers_yml && repoInspection.workers_summary?.valid ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <div className="font-medium">
                workers.yml found — {repoInspection.workers_summary.worker_count} workers across {repoInspection.workers_summary.component_count} component{repoInspection.workers_summary.component_count === 1 ? "" : "s"}
              </div>
              <ul className="mt-0.5 space-y-0.5 text-xs">
                {repoInspection.workers_summary.components?.map((c) => (
                  <li key={c.name}>
                    <span className="font-mono">{c.name}</span>: {c.workers.join(", ")}
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-xs">
                queue_family=<span className="font-mono">{repoInspection.workers_summary.queue_family}</span>{" "}
                zone=<span className="font-mono">{repoInspection.workers_summary.zone}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <div className="font-medium">
                {repoInspection.has_workers_yml
                  ? "workers.yml failed validation"
                  : "ScaledJob needs devops/workers.yml"}
              </div>
              {repoInspection.workers_summary?.errors?.length ? (
                <ul className="mt-0.5 space-y-0.5 text-xs font-mono">
                  {repoInspection.workers_summary.errors.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs">
                  Commit a <code className="rounded bg-amber-100 px-1 font-mono text-[11px] dark:bg-amber-900/40">devops/workers.yml</code> at the
                  repo root. See manComm/05-14-26/JER-dc-ml-scrapers.md
                  for the schema.
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* Monorepo / polyworkload: surface devops/components.yml status.
          Read-only preview — Phase 0 of the components.yml work. Form
          submission still treats this as a single deployment (Phases
          1-4 will fan out to N component records). See
          manComm/05-14-26/MARK-monorepo-phase0.md. */}
      {repoInspection?.has_components_yml && (
        repoInspection.components_summary?.valid ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-medium">
                components.yml found —{" "}
                {repoInspection.components_summary.component_count} components
                ({repoInspection.components_summary.image_target === "shared" ? "shared image" : "per-component images"})
              </div>
              {repoInspection.components_summary.kind_counts && (
                <div className="mt-0.5 text-xs">
                  {Object.entries(repoInspection.components_summary.kind_counts)
                    .map(([k, n]) => `${n} ${k}`)
                    .join(" + ")}
                </div>
              )}
              <ul className="mt-1 space-y-0.5 text-xs">
                {repoInspection.components_summary.components?.map((c) => (
                  <li key={c.name}>
                    <span className="font-mono">{c.name}</span>{" "}
                    <span className="text-[10px] uppercase tracking-wide opacity-75">
                      {c.workload_kind}/{c.role}
                    </span>
                    {c.replicas !== 1 && <span className="opacity-75"> · {c.replicas} replicas</span>}
                    {c.schedule && <span className="opacity-75"> · {c.schedule}</span>}
                    {c.port !== 80 && c.workload_kind !== "CronJob" && (
                      <span className="opacity-75"> · :{c.port}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-[11px] italic opacity-75">
                Preview only — multi-component fan-out lands in a later phase. Submit treats this as a single deployment for now.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <div className="font-medium">components.yml failed validation</div>
              {repoInspection.components_summary?.errors?.length ? (
                <ul className="mt-0.5 space-y-0.5 text-xs font-mono">
                  {repoInspection.components_summary.errors.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )
      )}

      {/* UI workloads: surface framework + render-mode + package manager so
          the dev sees what the deployment will look like before submit.
          The render_mode hint matters most — Next.js SSR repos need a Node
          container (port 3000), not nginx static. */}
      {role === "UI" && repoInspection?.inferred_framework && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
          <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">UI detected</span>
              <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide dark:bg-emerald-900/40">
                {repoInspection.inferred_framework}
              </span>
              {repoInspection.inferred_render_mode && (
                <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide dark:bg-emerald-900/40">
                  {repoInspection.inferred_render_mode}
                </span>
              )}
              {repoInspection.inferred_package_manager && (
                <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide dark:bg-emerald-900/40">
                  {repoInspection.inferred_package_manager}
                </span>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              {repoInspection.inferred_default_port && (
                <span>
                  port: <span className="font-mono">{repoInspection.inferred_default_port}</span>
                </span>
              )}
              {repoInspection.inferred_build_output && (
                <span>
                  build: <span className="font-mono">{repoInspection.inferred_build_output}/</span>
                </span>
              )}
              {repoInspection.inferred_env_prefix && (
                <span>
                  env prefix: <span className="font-mono">{repoInspection.inferred_env_prefix}*</span>
                </span>
              )}
            </div>
            {repoInspection.inferred_render_mode?.startsWith("ssr") && (
              <div className="mt-1 text-xs">
                <strong>SSR mode:</strong> needs a Node runtime container (not
                nginx). Dockerfile should{" "}
                <code className="rounded bg-emerald-100 px-1 font-mono text-[11px] dark:bg-emerald-900/40">CMD ["node", "server.js"]</code>{" "}
                and listen on{" "}
                <span className="font-mono">
                  {repoInspection.inferred_default_port}
                </span>
                .
              </div>
            )}
          </div>
        </div>
      )}

      {deployedClusterEntries.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">
              {deployedClusterEntries.length === 1
                ? `This repo already has ${deployedClusterEntries[0][1].join(" + ")} deployed on ${deployedClusterEntries[0][0]}`
                : "This repo is deployed across multiple clusters"}
            </div>
            <ul className="mt-0.5 space-y-0.5 text-xs">
              {deployedClusterEntries.map(([c, envs]) => (
                <li key={c}>
                  <span className="font-mono">{c}</span>: {envs.join(", ")}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs">
              {lockedCluster && missingEnvsHere.length > 0 && (
                <>
                  Locked to <span className="font-mono">{lockedCluster}</span>;{" "}
                  <span className="font-mono">{missingEnvsHere.join(" + ")}</span>{" "}
                  auto-selected as the remaining env
                  {missingEnvsHere.length === 1 ? "" : "s"} to bootstrap.
                </>
              )}
              {lockedCluster && missingEnvsHere.length === 0 && (
                <>
                  Both envs are already bootstrapped here — there's nothing
                  left to submit. Tag the repo (vX.Y.Z) to ship a release.
                </>
              )}
              {!lockedCluster && (
                <>
                  Pick a cluster manually — the repo has manifests on more
                  than one and we don't auto-resolve.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top row · 3 cols — the basics every request has */}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Requested by" required>
          <input
            type="email"
            required
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="dev@seven-gen.com"
            className={inputAccentClass}
          />
        </Field>
        <Field
          label="Repository"
          required
          hint={
            slug ? (
              <span className="font-mono">
                <span className={slugValid === "good" ? "text-emerald-600" : "text-amber-600"}>
                  {slugValid === "good" ? "✓" : "⚠"}
                </span>{" "}
                slug: {slug}
              </span>
            ) : (
              <span className="truncate">Workspace: <code className="rounded bg-muted px-1 font-mono text-[11px]">metawhale</code></span>
            )
          }
        >
          <div className="flex gap-2">
            <input
              type="text"
              required
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="my_repo or full URL"
              className={`${inputAccentClass} flex-1`}
            />
            {/* Refresh inspect without a full page reload — useful after
                pushing devops/components.yml from a pulse-align run.
                Disabled until a valid slug exists so the click does
                something. */}
            <button
              type="button"
              onClick={() => setRefreshTick((t) => t + 1)}
              disabled={slugValid !== "good" || inspecting}
              title="Re-inspect this repo (after pushing devops/components.yml)"
              className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                slugValid === "good" && !inspecting
                  ? "border-[#e8871e] bg-card hover:bg-muted"
                  : "cursor-not-allowed border-border opacity-50"
              }`}
            >
              {inspecting ? "Inspecting…" : "↻ Refresh"}
            </button>
          </div>
        </Field>
        <Field label="DNS zone">
          <select
            value={domainZone}
            disabled={!domainUsed}
            onChange={(e) => setDomainZone(e.target.value as DomainZone)}
            className={`${inputAccentClass} ${!domainUsed ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {DOMAIN_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Body · 2 cols — Workload left, Env vars right */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Workload card ── */}
        <div className="rounded-2xl border bg-card p-5">
          <div className="space-y-3.5">
            <PillRow label="Team" lockedNote={null}>
              {TEAMS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTeam(t.value)}
                  className={`${pillBase} ${team === t.value ? pillActive : pillIdle}`}
                >
                  {t.label}
                </button>
              ))}
            </PillRow>

            {/* Workload shape banner — always shown.
                - Green when devops/components.yml or workers.yml present;
                  shape comes from the repo spec.
                - Amber when neither file present; form submits with fallback
                  defaults (Deployment/API:8000) so the pipeline doesn't
                  break, but admin should add a spec via /pulse-align.
                Role/Kind/Port inputs are no longer surfaced in the form —
                the repo owns the shape. */}
            {repoInspection?.has_components_yml || repoInspection?.has_workers_yml ? (
              <div className="flex gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
                <span className="mt-0.5 flex-shrink-0">✓</span>
                <span>
                  Workload shape from{" "}
                  <code className="rounded bg-emerald-100 px-1 font-mono dark:bg-emerald-900/40">
                    devops/{repoInspection?.has_components_yml ? "components.yml" : "workers.yml"}
                  </code>
                  .{" "}
                  {repoInspection?.components_summary?.valid && (repoInspection.components_summary.component_count ?? 0) > 0 ? (
                    <>
                      Detected:{" "}
                      <span className="font-medium">
                        {repoInspection.components_summary.component_count}{" "}
                        {repoInspection.components_summary.component_count === 1 ? "component" : "components"}
                      </span>
                      {repoInspection.components_summary.kind_counts && (
                        <>
                          {" "}(
                          {Object.entries(repoInspection.components_summary.kind_counts)
                            .map(([k, n]) => `${n} ${k}`)
                            .join(", ")}
                          )
                        </>
                      )}
                      .
                    </>
                  ) : (
                    <>
                      Detected:{" "}
                      <span className="font-medium">
                        {workloadKind}
                        {role && role !== "Worker" ? `/${role}` : ""}
                      </span>
                      .
                    </>
                  )}{" "}
                  To change shape, edit the file in the repo.
                </span>
              </div>
            ) : repoInspection ? (
              <div className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-xs text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
                  <div className="flex-1">
                    <div className="font-semibold">
                      Submit blocked —{" "}
                      <code className="rounded bg-red-100 px-1 font-mono dark:bg-red-900/40">
                        devops/components.yml
                      </code>{" "}
                      required for every Pulse-managed repo.
                    </div>
                    <div className="mt-1 text-red-800/90 dark:text-red-300/90">
                      Bootstrap the repo with pulse-align (scaffolds
                      Dockerfile.{"{staging,prod}"} + components.yml + non-root
                      USER + /health + devops/test.sh). Three steps below —
                      install plugin → run skill → commit + push, then refresh.
                    </div>
                  </div>
                </div>

                {/* Step 1 — install plugin (one-time per dev machine). */}
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-200 font-mono text-[10px] dark:bg-red-900/60">1</span>
                    Install the plugin (skip if already installed)
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 select-all whitespace-pre-wrap rounded-lg border border-red-300 bg-red-100/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed dark:border-red-800 dark:bg-red-900/40">
{`/plugin marketplace add git@bitbucket.org:metawhale/ash-tadi.git
/plugin install pulse-align@seven-gen`}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard?.writeText(
                          "/plugin marketplace add git@bitbucket.org:metawhale/ash-tadi.git\n/plugin install pulse-align@seven-gen"
                        )
                      }
                      title="Copy plugin install commands"
                      className="self-start rounded-lg border border-red-300 bg-red-100 px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-red-200 dark:border-red-800 dark:bg-red-900/40 dark:hover:bg-red-900/60"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Step 2 — activate skill inside the app repo. */}
                <div className="mt-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-200 font-mono text-[10px] dark:bg-red-900/60">2</span>
                    Run the skill inside your app repo
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 select-all rounded-lg border border-red-300 bg-red-100/60 px-2 py-1.5 font-mono text-[11px] dark:border-red-800 dark:bg-red-900/40">
                      /pulse-align
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText("/pulse-align")}
                      title="Copy /pulse-align"
                      className="rounded-lg border border-red-300 bg-red-100 px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-red-200 dark:border-red-800 dark:bg-red-900/40 dark:hover:bg-red-900/60"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Step 3 — commit + push then come back here. */}
                <div className="mt-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-red-800 dark:text-red-300">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-200 font-mono text-[10px] dark:bg-red-900/60">3</span>
                    Commit + push the scaffolded files
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 select-all whitespace-pre-wrap rounded-lg border border-red-300 bg-red-100/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed dark:border-red-800 dark:bg-red-900/40">
{`git add devops/ && git commit -m "Add Pulse-align scaffolding"
git push origin main`}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard?.writeText(
                          'git add devops/ && git commit -m "Add Pulse-align scaffolding"\ngit push origin main'
                        )
                      }
                      title="Copy git add/commit/push"
                      className="self-start rounded-lg border border-red-300 bg-red-100 px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-red-200 dark:border-red-800 dark:bg-red-900/40 dark:hover:bg-red-900/60"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] italic text-red-800/80 dark:text-red-300/80">
                    Reference:{" "}
                    <a
                      href="https://bitbucket.org/metawhale/ash-tadi/src/main/plugins/pulse-align/skills/pulse-align/SKILL.md"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:no-underline"
                    >
                      pulse-align skill docs (ash-tadi)
                    </a>
                    . The skill detects your repo's workload kind, scaffolds
                    the canonical shape, and emits the exact Pulse form
                    selections you'll need.
                  </div>
                  <button
                    type="button"
                    onClick={() => setRefreshTick((t) => t + 1)}
                    disabled={inspecting}
                    title="Re-inspect this repo"
                    className={`flex-shrink-0 rounded-lg border border-red-400 bg-red-100 px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-red-200 dark:border-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 ${
                      inspecting ? "cursor-not-allowed opacity-50" : ""
                    }`}
                  >
                    {inspecting ? "Inspecting…" : "↻ Re-inspect"}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Ingress toggle — only shown for repos WITHOUT components.yml
                or workers.yml (legacy fallback path). When a spec file is
                present, ingress is declared per-component in components.yml
                (needs_ingress: true|false) and the form-level toggle is
                redundant. ScaledJob is queue-driven — toggle always hidden,
                needs_ingress forced false. */}
            {!isScaledJob && !repoInspection?.has_components_yml && !repoInspection?.has_workers_yml && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={needsIngress}
                onChange={(e) => {
                  setNeedsIngress(e.target.checked);
                  setIngressTouched(true);
                }}
                className="h-4 w-4 rounded border-border accent-[#e8871e]"
              />
              <span>
                Needs public ingress + TLS
                <span className="ml-1 text-xs italic text-muted-foreground">
                  (off for internal/queue-driven workloads)
                </span>
              </span>
            </label>
            )}

            {/* Infisical scope opt-in. On approve, Pulse creates the
                project + env + folder in Infisical automatically, and
                the manifest generator emits an InfisicalSecret CR per
                component. Dev then populates secret VALUES in the
                Infisical UI. */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={secretsEnabled}
                onChange={(e) => setSecretsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[#e8871e]"
              />
              <span>
                Provision Infisical secret scope
                <span className="ml-1 text-xs italic text-muted-foreground">
                  (project + env + folder auto-created; values go in Infisical UI)
                </span>
              </span>
            </label>

            <PillRow
              label="Cluster"
              lockedNote={
                lockedCluster ? `locked → already on ${lockedCluster}` : null
              }
            >
              {CLUSTERS.map((c) => {
                const clusterDisabled =
                  lockedCluster !== null && c !== lockedCluster;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={clusterDisabled}
                    title={
                      clusterDisabled
                        ? `Repo is already bootstrapped on ${lockedCluster}`
                        : undefined
                    }
                    onClick={() => !clusterDisabled && setCluster(c)}
                    className={`${pillBase} font-mono ${
                      clusterDisabled
                        ? pillDisabled
                        : cluster === c
                          ? pillActive
                          : pillIdle
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </PillRow>

            <PillRow label="Environments">
              {ENVIRONMENTS.map((env) => {
                const active = environments.includes(env.value);
                const alreadyDeployed = existingEnvsHere.includes(env.value);
                return (
                  <button
                    key={env.value}
                    type="button"
                    disabled={alreadyDeployed}
                    title={
                      alreadyDeployed
                        ? `${env.label} is already bootstrapped on ${cluster}`
                        : undefined
                    }
                    onClick={() => !alreadyDeployed && toggleEnv(env.value)}
                    className={`${pillBase} ${
                      alreadyDeployed
                        ? pillDisabled
                        : active
                          ? pillActive
                          : pillIdle
                    }`}
                  >
                    {env.label}
                    {alreadyDeployed && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        (deployed)
                      </span>
                    )}
                    <span className="ml-1.5 rounded bg-muted px-1 font-mono text-[10px]">
                      {env.tag}
                    </span>
                  </button>
                );
              })}
            </PillRow>
            {envsDisabled && (
              <p className="text-xs text-red-500">Pick at least one environment.</p>
            )}

            {domainUsed && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">Host</span>
                  {!overrideHost ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDomain(appName ? `${appName}.${domainZone}` : "");
                        setOverrideHost(true);
                      }}
                      className="text-xs font-medium text-[#e8871e] hover:text-[#c2410c] dark:text-[#fbbf24]"
                    >
                      Override
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideHost(false);
                        setDomain("");
                      }}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      Use auto
                    </button>
                  )}
                </div>
                {overrideHost ? (
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="my-app.media-meter.in"
                    className={`${inputClass} font-mono`}
                  />
                ) : previewHosts.length === 0 ? (
                  <div className={`${inputClass} cursor-default select-text bg-muted/40 font-mono text-xs italic text-muted-foreground`}>
                    enter a repo first…
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {previewHosts.map(({ env, host }) => (
                      <div
                        key={env}
                        className={`${inputClass} flex items-center justify-between gap-2 bg-muted/40 py-1.5 font-mono text-xs`}
                      >
                        <span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {env}
                        </span>
                        <span className="truncate text-foreground" title={host}>
                          {host}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Port comes from spec — only shown for legacy repos
                    without components.yml (port matters there for the
                    single-app generator path). For spec-driven repos,
                    port lives per-component in components.yml. */}
                {!repoInspection?.has_components_yml && !repoInspection?.has_workers_yml && (
                  <div className="mt-2 text-xs italic text-muted-foreground">
                    Port: <span className="font-mono">from inspect heuristic ({port})</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Env vars card ── */}
        <div className="rounded-2xl border bg-card p-5">
          {isScaledJob && (
            <div className="mb-3 flex gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                These env vars become the L3 component <code className="rounded bg-blue-100 px-1 font-mono dark:bg-blue-900/40">config.properties</code> — copied verbatim into every component (article, section, ...) since the worker matrix shares the same Redis / BASE_URL / PROXY_URI baseline. Per-worker overrides go in <code className="rounded bg-blue-100 px-1 font-mono dark:bg-blue-900/40">devops/workers.yml</code>.
              </span>
            </div>
          )}
          {isFrontend && (
            <label className="mb-3 flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={showFrontendEnv}
                onChange={(e) => {
                  setShowFrontendEnv(e.target.checked);
                  if (!e.target.checked) {
                    setEnvVarsStaging("");
                    setEnvVarsProduction("");
                  }
                }}
                className="h-4 w-4 rounded border-border accent-[#e8871e]"
              />
              This Frontend app needs runtime env vars
            </label>
          )}

          {isFrontend && !showFrontendEnv ? (
            <EmptyEnvCard
              title="Frontend apps don't need env vars"
              body="Tick the box above only if your Next.js server-side routes need runtime vars at start-up."
            />
          ) : envVisible ? (
            <>
              <div className="mb-3 flex items-center gap-1.5 border-b">
                {ENVIRONMENTS.map((env) => {
                  const picked = environments.includes(env.value);
                  const active = activeEnvTab === env.value;
                  if (!picked) return null;
                  return (
                    <button
                      key={env.value}
                      type="button"
                      onClick={() => setActiveEnvTab(env.value)}
                      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? "border-[#e8871e] text-[#c2410c] dark:border-[#fbbf24] dark:text-[#fbbf24]"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {env.label}
                      <span className="ml-1.5 rounded bg-muted px-1 font-mono text-[10px]">
                        {env.tag}
                      </span>
                    </button>
                  );
                })}
                {envsDisabled && (
                  <span className="px-3 py-1.5 text-xs italic text-muted-foreground">
                    Pick an environment to add env vars.
                  </span>
                )}
              </div>

              {!envsDisabled && (
                <>
                  {activeEnvTab === "staging" && (
                    <textarea
                      value={envVarsStaging}
                      onChange={(e) => setEnvVarsStaging(e.target.value)}
                      placeholder={"LOG_LEVEL=debug\nAPP_TIMEOUT=30\nFEATURE_FLAG_X=true"}
                      rows={9}
                      required={envRequired && stagingPicked}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  )}
                  {activeEnvTab === "production" && (
                    <textarea
                      value={envVarsProduction}
                      onChange={(e) => setEnvVarsProduction(e.target.value)}
                      placeholder={"LOG_LEVEL=info\nAPP_TIMEOUT=30\nFEATURE_FLAG_X=true"}
                      rows={9}
                      required={envRequired && productionPicked}
                      className={`${inputClass} font-mono text-xs`}
                    />
                  )}
                  <div className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
                    <p>
                      One <code className="rounded bg-muted px-1 font-mono text-[11px]">KEY=VALUE</code> per line — non-secret app config only (LOG_LEVEL, APP_TAG, feature flags, ports, region settings). Lands in the per-app <code className="rounded bg-muted px-1 font-mono text-[11px]">config.properties</code> ConfigMap.
                    </p>
                    <p>
                      Do <strong>not</strong> paste DB URIs, API keys, or anything confidential. Per-app secrets aren&rsquo;t supported yet — talk to DevOps.
                    </p>
                    <details className="rounded-md border border-border bg-muted/30 px-2 py-1">
                      <summary className="cursor-pointer select-none text-xs">
                        Already injected globally — don&rsquo;t re-paste these {GLOBAL_INJECTED_KEYS.length} keys
                      </summary>
                      <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] sm:grid-cols-3">
                        {GLOBAL_INJECTED_KEYS.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-[11px] italic">
                        Sourced from <code className="rounded bg-muted px-1 font-mono">global/devops-global-secrets</code> and auto-mirrored into every namespace via Reflector.
                      </p>
                    </details>
                  </div>
                  {/* Collision warning — fires when a pasted KEY matches a
                      globally-injected key. The Secret's envFrom comes
                      AFTER the ConfigMap's so the dev's value would be
                      silently overridden at pod start. */}
                  {(() => {
                    const text = activeEnvTab === "staging" ? envVarsStaging : envVarsProduction;
                    if (!text.trim()) return null;
                    const pasted = new Set(
                      text
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter((line) => line && !line.startsWith("#") && line.includes("="))
                        .map((line) => line.split("=", 1)[0].trim())
                    );
                    const collisions = GLOBAL_INJECTED_KEYS.filter((k) => pasted.has(k));
                    if (collisions.length === 0) return null;
                    return (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          <strong>{collisions.length}</strong> key{collisions.length === 1 ? "" : "s"} already injected globally — the cluster secret wins, your pasted value will be ignored at runtime:{" "}
                          <span className="font-mono">{collisions.join(", ")}</span>
                        </span>
                      </p>
                    );
                  })()}
                  {/* UI framework env-prefix warning. Vite, Next, CRA strip
                      any env var without the right prefix at build time —
                      surfacing this here prevents the silent-bug class. */}
                  {(() => {
                    const prefix = repoInspection?.inferred_env_prefix;
                    if (!prefix || role !== "UI") return null;
                    const text = activeEnvTab === "staging" ? envVarsStaging : envVarsProduction;
                    if (!text.trim()) return null;
                    const offenders = text
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter((line) => line && !line.startsWith("#") && line.includes("="))
                      .map((line) => line.split("=", 1)[0].trim())
                      .filter((key) => key && !key.startsWith(prefix));
                    if (offenders.length === 0) return null;
                    return (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                        <span>
                          <strong>{offenders.length}</strong> var{offenders.length === 1 ? "" : "s"} missing{" "}
                          <code className="rounded bg-amber-100 px-1 font-mono text-[11px] dark:bg-amber-900/40">{prefix}</code>{" "}
                          prefix and will be silently stripped at build time:{" "}
                          <span className="font-mono">
                            {offenders.slice(0, 5).join(", ")}
                            {offenders.length > 5 ? `, +${offenders.length - 5} more` : ""}
                          </span>
                        </span>
                      </p>
                    );
                  })()}
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Footer — live link preview per env + submit */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
          {domainUsed ? (
            previewHosts.length === 0 || !appName ? (
              <span className="italic text-muted-foreground">enter a repo to preview the link</span>
            ) : (
              previewHosts.map(({ env, host }) => (
                <span key={env} className="inline-flex items-center gap-1.5">
                  <span className="rounded bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {env}
                  </span>
                  <span>https://{host}</span>
                </span>
              ))
            )
          ) : (
            <span className="italic text-muted-foreground">no public link — workload doesn&apos;t serve HTTP</span>
          )}
        </div>
        <button
          type="submit"
          disabled={loading || envsDisabled || repoBlockReason !== null || specBlockReason !== null || inspecting}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          <Rocket className="h-4 w-4" />
          {loading
            ? "Submitting…"
            : inspecting
              ? "Checking repo…"
              : "Submit request"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        {label}
        {required && <span className="text-red-500">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function PillRow({
  label,
  lockedNote,
  children,
}: {
  label: string;
  lockedNote?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
        {label}
        {lockedNote && <LockedChip note={lockedNote} />}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function EmptyEnvCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl border border-dashed bg-muted/30 px-4 py-5 text-sm">
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function SuccessCard({
  submitted,
  conflictStrategy,
  onSubmitAnother,
}: {
  submitted: SubmittedDeployment[];
  conflictStrategy: string | null;
  onSubmitAnother: () => void;
}) {
  // SEV: backend created N records (one per env). For the dev's tracking
  // experience we surface only ONE URL — the first record's token — and
  // the track page expands to show all sibling envs under that one URL.
  const primary = submitted[0];
  const envs = submitted.map((r) => r.environments[0]).filter(Boolean);
  const trackUrl = primary.trackUrl ?? "";
  const fullTrackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${trackUrl}`
      : trackUrl;
  const [copied, setCopied] = useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900/50 dark:bg-emerald-900/20">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/20">
          <Check className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">
            Request submitted
          </h2>
          <p className="text-sm text-emerald-800/80 dark:text-emerald-300/80">
            <span className="font-mono">{primary.repoSlug}</span> · {primary.cluster} · {envs.join(" + ")}
          </p>
        </div>
      </div>

      <p className="text-sm text-emerald-900 dark:text-emerald-200">
        <strong>Waiting for DevOps approval{submitted.length > 1 ? " for each env" : ""}.</strong>{" "}
        Each env is an independent record under the hood — no shared status
        field, no aggregate races. The link below shows them all in one view.
      </p>

      {conflictStrategy === "delete_and_repush" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          Bootstrap tag(s) already existed — plan is to{" "}
          <strong>delete and re-push</strong> so Bitbucket fires the webhook. Safe
          because no release tags were found.
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-emerald-900 dark:text-emerald-300">
          Tracking link (never expires)
        </label>
        <div className="flex gap-2">
          <input
            readOnly
            value={fullTrackUrl}
            className="flex-1 cursor-text rounded-lg border bg-card px-3 py-1.5 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(fullTrackUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              } catch {
                /* clipboard blocked; user can still copy manually */
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={trackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onSubmitAnother}
          className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          Submit another
        </button>
      </div>
    </div>
  );
}
