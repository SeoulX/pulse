"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { mutate } from "swr";
import { Rocket, AlertTriangle, Copy, Check, ExternalLink } from "lucide-react";
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

const WORKLOAD_KINDS = [
  { value: "Deployment", label: "Deploy" },
  { value: "StatefulSet", label: "STS" },
  { value: "ScaledJob", label: "SJ" },
  { value: "CronJob", label: "CJ" },
] as const;

const ROLES = [
  { value: "API", label: "API" },
  { value: "UI", label: "UI" },
  { value: "Worker", label: "Worker" },
] as const;

const TEAMS = [
  { value: "Backend", label: "Backend", hint: "<cluster>/<app>/" },
  { value: "Frontend", label: "Frontend", hint: "<cluster>/<app>/" },
  { value: "DC", label: "DC", hint: "<cluster>/data-collection/<app>/" },
  { value: "ML", label: "ML", hint: "<cluster>/data-collection/<app>/" },
] as const;

const CLUSTERS = ["kl-1", "kl-2", "net3", "net4"] as const;

const ENVIRONMENTS = [
  { value: "staging", label: "staging", tag: "v0.0.0-alpha" },
  { value: "production", label: "production", tag: "v0.0.0" },
] as const;

type WorkloadKind = (typeof WORKLOAD_KINDS)[number]["value"];
type Role = (typeof ROLES)[number]["value"];
type Team = (typeof TEAMS)[number]["value"];
type Cluster = (typeof CLUSTERS)[number];
type Environment = (typeof ENVIRONMENTS)[number]["value"];

const inputClass =
  "w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20";

const pillBase =
  "rounded-xl border px-4 py-2 text-sm font-medium transition-all";
const pillActive =
  "border-[#e8871e] bg-[#e8871e]/10 text-[#e8871e] dark:border-[#2a7f9e] dark:bg-[#2a7f9e]/10 dark:text-[#5ab4c5]";
const pillIdle = "border-border hover:bg-muted";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubmittedDeployment {
  _id: string;
  repoSlug: string;
  team: string;
  workloadKind: string;
  role: string | null;
  cluster: string;
  environments: string[];
  manifestPath?: string;
  status: string;
  requestedBy: string;
  createdAt: string;
  trackToken?: string;
  trackUrl?: string;
}

interface DeploymentFormProps {
  onSubmitted?: (dep: SubmittedDeployment) => void;
}

export function DeploymentForm({ onSubmitted }: DeploymentFormProps = {}) {
  const { user } = useAuth();
  const [requestedBy, setRequestedBy] = useState("");
  const [repoUrl, setRepoUrl] = useState("");

  useEffect(() => {
    if (user?.email && !requestedBy) setRequestedBy(user.email);
  }, [user?.email, requestedBy]);
  const [team, setTeam] = useState<Team>("Backend");
  const [workloadKind, setWorkloadKind] = useState<WorkloadKind>("Deployment");
  const [role, setRole] = useState<Role>("API");
  const [cluster, setCluster] = useState<Cluster>("kl-1");
  const [environments, setEnvironments] = useState<Environment[]>([
    "staging",
    "production",
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSubmitted, setLastSubmitted] = useState<SubmittedDeployment | null>(
    null
  );
  const [lastConflictStrategy, setLastConflictStrategy] = useState<
    string | null
  >(null);
  const [copied, setCopied] = useState(false);

  const isDeployment = workloadKind === "Deployment";
  const envsDisabled = environments.length === 0;

  const toggleEnv = (env: Environment) => {
    setEnvironments((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]
    );
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
    setLoading(true);

    try {
      const res = await apiFetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          requested_by: requestedBy.trim(),
          team,
          workload_kind: workloadKind,
          role: isDeployment ? role : null,
          cluster,
          environments,
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
      setRepoUrl("");
      setTeam("Backend");
      setWorkloadKind("Deployment");
      setRole("API");
      setCluster("kl-1");
      setEnvironments(["staging", "production"]);
      // keep requestedBy as-is for convenience on repeat submits
      mutate("/api/deployments");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <h3 className="text-lg font-semibold">New Deployment Request</h3>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}


      {lastSubmitted && lastSubmitted.trackUrl && (
        <div className="space-y-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm dark:border-green-900/50 dark:bg-green-900/20">
          <div className="text-green-800 dark:text-green-300">
            Request submitted for{" "}
            <span className="font-mono font-semibold">
              {lastSubmitted.repoSlug}
            </span>{" "}
            ({lastSubmitted.cluster},{" "}
            {lastSubmitted.environments.join(" + ")}). <strong>Waiting for DevOps approval</strong> — the pipeline
            will run once an admin approves the request. Jenkins dispatch still a dry run until wired.
          </div>
          {lastConflictStrategy === "delete_and_repush" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
              Bootstrap tag(s) already existed — plan is to{" "}
              <strong>delete and re-push</strong> them so Bitbucket fires the
              webhook. Safe because no release tags were found.
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-green-900 dark:text-green-300">
              Tracking link (never expires)
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={
                  typeof window !== "undefined"
                    ? `${window.location.origin}${lastSubmitted.trackUrl}`
                    : lastSubmitted.trackUrl
                }
                className="flex-1 cursor-text rounded-lg border bg-background px-3 py-1.5 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={async () => {
                  const url =
                    typeof window !== "undefined"
                      ? `${window.location.origin}${lastSubmitted.trackUrl}`
                      : lastSubmitted.trackUrl!;
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  } catch {
                    /* clipboard blocked; user can still copy manually */
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={lastSubmitted.trackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Requested By (email)
          </label>
          <input
            type="email"
            required
            value={requestedBy}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="dev@seven-gen.com"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {user?.email
              ? "Prefilled from your account — change if you're submitting on someone else's behalf."
              : "Your email — we'll attach it to the request so the team knows who to ping."}
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Bitbucket Repository
          </label>
          <input
            type="text"
            required
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://bitbucket.org/metawhale/my_repo or my_repo"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Workspace must be <code className="rounded bg-muted px-1 font-mono">metawhale</code> — paste the full Bitbucket URL or just the repo slug.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Team</label>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTeam(t.value)}
                className={`${pillBase} ${
                  team === t.value ? pillActive : pillIdle
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Manifests will land in{" "}
            <code className="rounded bg-muted px-1 font-mono">
              {TEAMS.find((t) => t.value === team)?.hint}
            </code>
            . Backend/Frontend land flat under the cluster; DC/ML go under{" "}
            <code className="rounded bg-muted px-1 font-mono">data-collection/</code>.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Deployment Type
          </label>
          <div className="flex flex-wrap gap-2">
            {WORKLOAD_KINDS.map((kind) => (
              <button
                key={kind.value}
                type="button"
                onClick={() => setWorkloadKind(kind.value)}
                className={`${pillBase} ${
                  workloadKind === kind.value ? pillActive : pillIdle
                }`}
              >
                {kind.label}
              </button>
            ))}
          </div>
        </div>

        {isDeployment && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">Role</label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
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
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              API uses envFrom + ingress; UI strips envFrom and uses UI image
              naming; Worker has no ingress.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Cluster</label>
          <div className="flex flex-wrap gap-2">
            {CLUSTERS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCluster(c)}
                className={`${pillBase} font-mono ${
                  cluster === c ? pillActive : pillIdle
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Environments
          </label>
          <div className="flex flex-wrap gap-2">
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
                  <span className="ml-2 rounded bg-muted px-1 font-mono text-xs">
                    {env.tag}
                  </span>
                </button>
              );
            })}
          </div>
          {envsDisabled && (
            <p className="mt-1 text-xs text-red-500">
              Pick at least one environment.
            </p>
          )}
        </div>
      </div>

      {!isDeployment && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-medium">
              {workloadKind} manifests are not auto-generated yet.
            </p>
            <p className="mt-1 text-xs">
              The Jenkins pipeline only renders Deployment today. Request will
              be recorded but manifests must be hand-written — see{" "}
              <code className="rounded bg-amber-100 px-1 font-mono dark:bg-amber-900/40">
                devops-tools/jenkins/schema.md
              </code>
              .
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          Dry run — Jenkins dispatch disabled
        </p>
        <p className="mt-1 text-xs">
          Submit records the request and prints the planned payload to the
          backend console. No webhook is added and no tags are pushed.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading || envsDisabled}
        className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
      >
        <Rocket className="h-4 w-4" />
        {loading ? "Submitting..." : "Submit (Dry Run)"}
      </button>
    </form>
  );
}
