"use client";

import { Fragment } from "react";
import { Check, CircleDashed, Loader2, X, Trash2, ExternalLink } from "lucide-react";

import type { SubmittedDeployment } from "@/components/deployment-form";

const STAGES = [
  { key: "received", label: "Received" },
  { key: "approved", label: "Approved" },
  { key: "webhook", label: "Webhook" },
  { key: "tags", label: "Tags pushed" },
  { key: "image_built", label: "Image built" },
  { key: "manifest_pushed", label: "Manifests" },
  { key: "completed", label: "Completed" },
] as const;

type StageIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function stageForStatus(status: string): {
  reached: StageIndex;
  failed: boolean;
  failedAt: StageIndex;
} {
  switch (status) {
    case "rejected":
      return { reached: 0, failed: true, failedAt: 1 };
    case "failed_build":
      return { reached: 3, failed: true, failedAt: 4 };
    case "failed_manifest":
      return { reached: 4, failed: true, failedAt: 5 };
    case "failed":
      return { reached: 5, failed: true, failedAt: 6 };
    case "completed":
      return { reached: 6, failed: false, failedAt: 0 };
    // New step-by-step "currently doing X" statuses. The Jenkinsfile fires
    // these at stage START so the UI mirrors Jenkins's stage view: the
    // matching stage renders with a spinner (isCurrent = reached+1).
    case "cleaning_up":
      return { reached: 5, failed: false, failedAt: 0 };
    case "pushing_manifest":
      return { reached: 4, failed: false, failedAt: 0 };
    case "building_image":
      return { reached: 3, failed: false, failedAt: 0 };
    // Legacy "stage just finished" statuses. Older Jenkinsfile versions
    // and pre-existing records use these — render one stage further along
    // than the in-progress counterparts above.
    case "manifest_pushed":
      return { reached: 5, failed: false, failedAt: 0 };
    case "image_built":
      return { reached: 4, failed: false, failedAt: 0 };
    case "tags_pushed":
      return { reached: 3, failed: false, failedAt: 0 };
    case "webhook_added":
      return { reached: 2, failed: false, failedAt: 0 };
    case "approved":
    case "dry_run":
      return { reached: 1, failed: false, failedAt: 0 };
    case "pending_approval":
    case "pending":
    default:
      return { reached: 0, failed: false, failedAt: 0 };
  }
}

function statusPill(status: string) {
  const styles: Record<string, string> = {
    pending_approval:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    approved:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    dry_run:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    pending:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    webhook_added:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    tags_pushed:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    image_built:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    building_image:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    manifest_pushed:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    pushing_manifest:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    cleaning_up:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    failed_build: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    failed_manifest: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return styles[status] ?? "bg-muted text-muted-foreground";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const delta = Date.now() - then;
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export interface ProgressCardData {
  repoSlug: string;
  team?: string;
  workloadKind: string;
  role: string | null;
  cluster: string;
  environments: string[];
  manifestPath?: string;
  status: string;
  envStatuses?: Record<string, string>;
  envErrors?: Record<string, string>;
  argocdLinks?: Record<string, string>;
  createdAt: string;
  requestedBy?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  error?: string | null;
}

interface EnvTrackerProps {
  env: string;
  status: string;
  error?: string;
  argocdLink?: string;
  rejectionReason?: string | null;
}

function EnvTracker({ env, status, error, argocdLink, rejectionReason }: EnvTrackerProps) {
  const { reached, failed, failedAt } = stageForStatus(status);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {env}
        </span>
        <span
          className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${statusPill(status)}`}
        >
          {status}
        </span>
      </div>
      <div className="flex items-start">
        {STAGES.map((stage, i) => {
          const done = i <= reached;
          const isFail = failed && i === failedAt;
          const isCurrent =
            !failed && i === reached + 1 && reached + 1 < STAGES.length;
          const failTooltip = isFail
            ? error || rejectionReason || `Failed at ${stage.label}`
            : undefined;
          return (
            <Fragment key={stage.key}>
              <div className="group relative flex min-w-0 flex-shrink-0 flex-col items-center gap-1.5">
                <div className="relative flex h-6 w-6 items-center justify-center">
                  {isCurrent && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#e8871e]/60 dark:bg-[#2a7f9e]/60" />
                  )}
                  <div
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full ${
                      isFail
                        ? "bg-red-500 text-white"
                        : isCurrent
                          ? "border-2 border-[#e8871e] bg-background text-[#e8871e] dark:border-[#2a7f9e] dark:text-[#5ab4c5]"
                          : done
                            ? "bg-[#e8871e] text-white dark:bg-[#2a7f9e]"
                            : "border border-dashed bg-background text-muted-foreground"
                    }`}
                  >
                    {isFail ? (
                      <X className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : done ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <CircleDashed className="h-3.5 w-3.5" />
                    )}
                  </div>
                </div>
                {failTooltip && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute -top-2 left-1/2 z-10 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] leading-snug text-red-700 opacity-0 shadow-md transition-opacity group-hover:opacity-100 dark:border-red-900/50 dark:bg-red-950 dark:text-red-300"
                  >
                    <div className="font-semibold">Failure cause</div>
                    <div className="mt-0.5 break-words">{failTooltip}</div>
                  </div>
                )}
                <span
                  className={`max-w-[4.5rem] truncate text-center text-[10px] leading-tight ${
                    done || isCurrent || isFail
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {stage.label}
                </span>
              </div>
              {i < STAGES.length - 1 && (
                <div
                  className={`mx-1 mt-3 h-px flex-1 ${
                    done && i < reached
                      ? "bg-[#e8871e] dark:bg-[#2a7f9e]"
                      : "bg-border"
                  }`}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      {status === "completed" && argocdLink && (
        <a
          href={argocdLink}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#e8871e] hover:underline dark:text-[#5ab4c5]"
        >
          <ExternalLink className="h-3 w-3" />
          Open in ArgoCD
        </a>
      )}
      {error && !argocdLink && (
        <p className="text-[11px] text-red-500">{error}</p>
      )}
    </div>
  );
}

export function DeploymentProgressCard({ data }: { data: ProgressCardData }) {
  // Render one tracker per env whenever the request targets more than one,
  // even before per-env callbacks land — each tracker is seeded from the
  // aggregate status and diverges as env-tagged callbacks arrive.
  const envStatuses = data.envStatuses ?? {};
  const renderPerEnv = data.environments.length > 1;

  return (
    <div className="rounded-xl border bg-background p-4 transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{data.repoSlug}</span>
        {data.team && (
          <span className="rounded-lg border border-[#e8871e]/40 bg-[#e8871e]/10 px-2 py-0.5 text-xs font-medium text-[#e8871e] dark:border-[#2a7f9e]/40 dark:bg-[#2a7f9e]/10 dark:text-[#5ab4c5]">
            {data.team}
          </span>
        )}
        <span className="rounded-lg border px-2 py-0.5 text-xs font-medium">
          {data.workloadKind}
          {data.role ? ` / ${data.role}` : ""}
        </span>
        <span className="rounded-lg border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {data.cluster}
        </span>
        <span className="rounded-lg border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {data.environments.join(" + ")}
        </span>
        <span
          className={`ml-auto rounded-lg px-2 py-0.5 text-xs font-medium ${statusPill(data.status)}`}
        >
          {data.status}
        </span>
      </div>
      {data.manifestPath && (
        <div className="mt-2 font-mono text-[11px] text-muted-foreground">
          → {data.manifestPath}
        </div>
      )}

      <div className="mt-4 space-y-5">
        {renderPerEnv ? (
          data.environments.map((env) => (
            <EnvTracker
              key={env}
              env={env}
              status={envStatuses[env] ?? data.status}
              error={data.envErrors?.[env] ?? undefined}
              argocdLink={data.argocdLinks?.[env]}
              rejectionReason={data.rejectionReason}
            />
          ))
        ) : (
          <EnvTracker
            env={data.environments.join(" + ") || "deployment"}
            status={data.status}
            error={data.error ?? undefined}
            // The ArgoCD link disappeared for single-env (post-SEV) records
            // because this branch didn't forward argocdLinks. Use the first
            // env's link — there is only one env in this branch.
            argocdLink={
              data.argocdLinks?.[data.environments[0] ?? ""] ?? undefined
            }
            rejectionReason={data.rejectionReason}
          />
        )}
      </div>

      {data.status === "rejected" && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
          <span className="font-medium">Rejected</span>
          {data.approvedBy ? <> by {data.approvedBy}</> : null}
          {data.rejectionReason ? <> — {data.rejectionReason}</> : null}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.requestedBy ?? ""}</span>
        <span>{relativeTime(data.createdAt)}</span>
      </div>
    </div>
  );
}

interface Props {
  submissions: SubmittedDeployment[];
  onClear: () => void;
}

export function DeploymentProgress({ submissions, onClear }: Props) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
        No submissions yet. Submit a deployment to see its progress here.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Your submissions</h3>
          <p className="text-xs text-muted-foreground">
            Saved in this browser. Auto-refreshes every 5s until each
            deployment reaches a terminal state.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      <ul className="space-y-4">
        {submissions.map((s) => (
          <li key={s._id}>
            <DeploymentProgressCard data={s} />
            {s.trackUrl && (
              <a
                href={s.trackUrl}
                className="mt-1.5 block truncate text-[11px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
              >
                {s.trackUrl}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
