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

const CLUSTERS = ["kl-1", "kl-2"] as const;

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
  // {cluster: envs-already-bootstrapped}. Scanned across both kl-1 and
  // kl-2 so the form can warn even when the dev picks the "empty" cluster
  // unaware that the app already lives on the other.
  existing_envs: Record<string, string[]>;
  // Sniffed from package.json / requirements.txt / pyproject.toml /
  // workers.yaml — null when no clear signal.
  inferred_workload_kind: string | null;
  inferred_role: string | null;
  inferred_team: string | null;
  // Present when devops/workers.yml exists. Parsed at inspect time so the
  // form can show the dev exactly what was found before they hit submit.
  workers_summary: WorkersSummary | null;
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
  const [needsIngress, setNeedsIngress] = useState(true);
  const [ingressTouched, setIngressTouched] = useState(false);
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

  // Default container port from the role unless dev overrode it.
  useEffect(() => {
    const portDef = ROLE_DEFAULT_PORT[role];
    if (portDef) setPort(portDef);
  }, [role]);

  // Default needsIngress from the role — API/UI/Streamlit get true, Worker
  // gets false (no public HTTP path). Skip once the user has toggled the
  // checkbox manually so we don't fight their choice.
  useEffect(() => {
    if (ingressTouched) return;
    const ingressByRole = role === "API" || role === "UI" || role === "Streamlit";
    setNeedsIngress(ingressByRole);
  }, [role, ingressTouched]);

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
  }, [inspectSlug.slug, inspectSlug.valid]);

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
          <input
            type="text"
            required
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="my_repo or full URL"
            className={inputAccentClass}
          />
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

            {/* Row order: Role first (sets the suggested workload kind),
                Kind second (auto-filled by the role / inspect; user can
                still click any pill — no disables). */}
            {roleVisible && (
              <div>
                <PillRow label="Role" lockedNote={null}>
                  {availableRoles.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`${pillBase} ${
                        role === r.value ? pillActive : pillIdle
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </PillRow>
                {role === "API" && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={withWorker}
                      onChange={(e) => setWithWorker(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border accent-[#e8871e]"
                    />
                    Also ships a worker (Dockerfile.worker alongside API)
                  </label>
                )}
                <p className="mt-1 text-xs italic text-muted-foreground">
                  {ROLE_HINTS[role]}
                </p>
              </div>
            )}

            <PillRow
              label="Kind"
              lockedNote={
                roleLocksToDeploy ? `${role} suggests Deploy` : null
              }
            >
              {availableKinds.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setWorkloadKind(k.value)}
                  className={`${pillBase} ${
                    workloadKind === k.value ? pillActive : pillIdle
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </PillRow>

            {isMultiWorker && (
              <div className="flex gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Scaffolded from <code className="rounded bg-blue-100 px-1 font-mono dark:bg-blue-900/40">devops/workers.yml</code>.
                  Port/host/env-vars come from that file.
                </span>
              </div>
            )}

            {/* Ingress toggle — default flips with role (API/UI/Streamlit
                → on, Worker → off) but the user can opt in/out either way.
                Hidden entirely for ScaledJob (workers are queue-driven —
                ingress never makes sense, and we force needs_ingress=false
                on submit regardless of checkbox state). */}
            {!isScaledJob && (
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
              <div className="grid gap-3 md:grid-cols-[1fr,5.5rem]">
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
                </div>
                <div>
                  <div className="mb-1 text-sm font-medium">Port</div>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    disabled={!portUsed}
                    onChange={(e) => setPort(Number(e.target.value) || 0)}
                    className={`${inputClass} ${!portUsed ? "cursor-not-allowed opacity-50" : ""}`}
                  />
                </div>
              </div>
            )}

            {!isDeployment && !isMultiWorker && (
              <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  {workloadKind} manifests aren&apos;t auto-generated yet — the
                  request records but DevOps writes the manifest.
                </span>
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
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    One <code className="rounded bg-muted px-1 font-mono text-[11px]">KEY=VALUE</code> per line. Goes into{" "}
                    <code className="rounded bg-muted px-1 font-mono text-[11px]">config.properties</code>. Do <strong>not</strong> paste secrets here.
                  </p>
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
          disabled={loading || envsDisabled || repoBlockReason !== null || inspecting}
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
