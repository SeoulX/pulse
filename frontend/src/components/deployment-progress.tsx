"use client";

import { Fragment } from "react";
import { Check, CircleDashed, Loader2, X, Trash2 } from "lucide-react";

import type { SubmittedDeployment } from "@/components/deployment-form";

const STAGES = [
  { key: "received", label: "Received" },
  { key: "approved", label: "Approved" },
  { key: "webhook", label: "Webhook" },
  { key: "tags", label: "Tags pushed" },
  { key: "completed", label: "Completed" },
] as const;

type StageIndex = 0 | 1 | 2 | 3 | 4;

function stageForStatus(status: string): {
  reached: StageIndex;
  failed: boolean;
  failedAt: StageIndex;
} {
  switch (status) {
    case "rejected":
      return { reached: 0, failed: true, failedAt: 1 };
    case "failed":
      return { reached: 1, failed: true, failedAt: 2 };
    case "completed":
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
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
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
  createdAt: string;
  requestedBy?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  error?: string | null;
}

export function DeploymentProgressCard({ data }: { data: ProgressCardData }) {
  const { reached, failed, failedAt } = stageForStatus(data.status);
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

      <div className="mt-4">
        <div className="flex items-start">
          {STAGES.map((stage, i) => {
            const done = i <= reached;
            const isFail = failed && i === failedAt;
            const isCurrent =
              !failed && i === reached + 1 && reached + 1 < STAGES.length;
            return (
              <Fragment key={stage.key}>
                <div className="flex min-w-0 flex-shrink-0 flex-col items-center gap-1.5">
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
      </div>

      {data.status === "rejected" && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
          <span className="font-medium">Rejected</span>
          {data.approvedBy ? <> by {data.approvedBy}</> : null}
          {data.rejectionReason ? <> — {data.rejectionReason}</> : null}
        </div>
      )}

      {data.error && data.status !== "rejected" && (
        <p className="mt-3 text-xs text-red-500">{data.error}</p>
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
            Saved in this browser. Jenkins dispatch is still a dry run — status
            will update once the pipeline is wired.
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
