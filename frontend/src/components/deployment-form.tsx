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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState<SubmittedDeployment | null>(
    null
  );
  const [lastConflictStrategy, setLastConflictStrategy] = useState<
    string | null
  >(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.email && !requestedBy) setRequestedBy(user.email);
  }, [user?.email, requestedBy]);

  const isDeployment = workloadKind === "Deployment";
  const isFrontend = team === "Frontend";
  const isDcMl = team === "DC/ML";
  const isMultiWorker = isDcMl && workloadKind === "ScaledJob";
  const envsDisabled = environments.length === 0;
  const envRequired = !isFrontend && !isMultiWorker;
  const envVisible = (!isFrontend || showFrontendEnv) && !isMultiWorker;
  const stagingPicked = environments.includes("staging");
  const productionPicked = environments.includes("production");
  const portUsed = isDeployment && role !== "Worker" && !isMultiWorker;
  const domainUsed = isDeployment && !isMultiWorker;
  const roleVisible = isDeployment && !isMultiWorker;

  // Team locks: Frontend → Deployment + UI; DC/ML → ScaledJob (role hidden).
  useEffect(() => {
    if (isFrontend) {
      setRole("UI");
      setWorkloadKind("Deployment");
    } else if (isDcMl) {
      setWorkloadKind("ScaledJob");
      setShowFrontendEnv(false);
    } else {
      setRole((prev) => (prev === "UI" ? "API" : prev));
      setShowFrontendEnv(false);
    }
  }, [isFrontend, isDcMl]);

  // Default container port from the role unless dev overrode it.
  useEffect(() => {
    const portDef = ROLE_DEFAULT_PORT[role];
    if (portDef) setPort(portDef);
  }, [role]);

  // Keep activeEnvTab pointing at a picked env so the textarea is always
  // showing something the user actually selected.
  useEffect(() => {
    if (!environments.includes(activeEnvTab) && environments.length > 0) {
      setActiveEnvTab(environments[0]);
    }
  }, [environments, activeEnvTab]);

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

  const availableRoles = isFrontend
    ? ROLES.filter((r) => r.value === "UI")
    : ROLES.filter((r) => r.value !== "UI");
  const availableKinds = isFrontend
    ? WORKLOAD_KINDS.filter((k) => k.value === "Deployment")
    : isDcMl
      ? WORKLOAD_KINDS.filter((k) => k.value === "ScaledJob")
      : WORKLOAD_KINDS;

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
    setCopied(false);
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
      onSubmitted?.(data as SubmittedDeployment);
      setLastSubmitted(data as SubmittedDeployment);
      setLastConflictStrategy(data.planned?.conflict_strategy ?? null);
      mutate("/api/deployments");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  if (lastSubmitted && lastSubmitted.trackUrl) {
    return (
      <SuccessCard
        submitted={lastSubmitted}
        conflictStrategy={lastConflictStrategy}
        copied={copied}
        setCopied={setCopied}
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
              <>Bitbucket workspace must be <code className="rounded bg-muted px-1 font-mono text-[11px]">metawhale</code>.</>
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

            <PillRow
              label="Kind"
              lockedNote={
                isFrontend ? "Frontend → Deploy" : isDcMl ? "DC/ML → ScaledJob" : null
              }
            >
              {availableKinds.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  disabled={isFrontend || isDcMl}
                  onClick={() => setWorkloadKind(k.value)}
                  className={`${pillBase} ${
                    workloadKind === k.value ? pillActive : isFrontend || isDcMl ? pillDisabled : pillIdle
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </PillRow>

            {roleVisible && (
              <div>
                <PillRow
                  label="Role"
                  lockedNote={isFrontend ? "Frontend → UI" : null}
                >
                  {availableRoles.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      disabled={isFrontend}
                      onClick={() => setRole(r.value)}
                      className={`${pillBase} ${
                        role === r.value ? pillActive : isFrontend ? pillDisabled : pillIdle
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </PillRow>
                {role === "API" && !isFrontend && (
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

            {isMultiWorker && (
              <div className="flex gap-2 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>
                  Scaffolded from <code className="rounded bg-blue-100 px-1 font-mono dark:bg-blue-900/40">devops/workers.yaml</code>.
                  Port/host/env-vars come from that file.
                </span>
              </div>
            )}

            <PillRow label="Cluster">
              {CLUSTERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCluster(c)}
                  className={`${pillBase} font-mono ${cluster === c ? pillActive : pillIdle}`}
                >
                  {c}
                </button>
              ))}
            </PillRow>

            <PillRow label="Environments">
              {ENVIRONMENTS.map((env) => {
                const active = environments.includes(env.value);
                return (
                  <button
                    key={env.value}
                    type="button"
                    onClick={() => toggleEnv(env.value)}
                    className={`${pillBase} ${active ? pillActive : pillIdle}`}
                  >
                    {env.label}
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

          {isMultiWorker ? (
            <EmptyEnvCard
              title="Env vars live in workers.yaml"
              body="Multi-worker apps ship env defaults in their repo. This form just records the deployment shell."
            />
          ) : isFrontend && !showFrontendEnv ? (
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
          disabled={loading || envsDisabled}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          <Rocket className="h-4 w-4" />
          {loading ? "Submitting…" : "Submit request"}
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
    <div className="flex h-full flex-col items-start justify-center gap-1 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-sm">
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

function SuccessCard({
  submitted,
  conflictStrategy,
  copied,
  setCopied,
  onSubmitAnother,
}: {
  submitted: SubmittedDeployment;
  conflictStrategy: string | null;
  copied: boolean;
  setCopied: (b: boolean) => void;
  onSubmitAnother: () => void;
}) {
  const trackUrl = submitted.trackUrl ?? "";
  const fullTrackUrl =
    typeof window !== "undefined" ? `${window.location.origin}${trackUrl}` : trackUrl;

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
            <span className="font-mono">{submitted.repoSlug}</span> · {submitted.cluster} · {submitted.environments.join(" + ")}
          </p>
        </div>
      </div>

      <p className="text-sm text-emerald-900 dark:text-emerald-200">
        <strong>Waiting for DevOps approval.</strong> Once approved, the webhook is
        registered, bootstrap tags are pushed, and Jenkins builds the image. Manifest
        generation runs from your <code className="rounded bg-emerald-100 px-1 font-mono text-xs dark:bg-emerald-900/40">spec.json</code>.
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
