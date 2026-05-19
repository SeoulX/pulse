"use client";

import { Fragment, useEffect, useState } from "react";
import useSWR from "swr";
import { Check, X, ChevronRight, ChevronDown, Copy, ExternalLink } from "lucide-react";

import { apiFetch } from "@/lib/api";

interface Deployment {
  _id: string;
  repoSlug: string;
  repoUrl: string;
  team?: string;
  workloadKind: string;
  role: string | null;
  cluster: string;
  environments: string[];
  envVars?: Record<string, string>;
  domain?: string | null;
  domainZone?: string;
  port?: number;
  manifestPath?: string;
  status: string;
  error: string | null;
  envStatuses?: Record<string, string>;
  envErrors?: Record<string, string>;
  argocdLinks?: Record<string, string>;
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  trackToken?: string;
  trackUrl?: string;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  Deployment: "Deploy",
  StatefulSet: "STS",
  ScaledJob: "SJ",
  CronJob: "CJ",
};

const STATUS_STYLES: Record<string, string> = {
  completed:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  pending_approval:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  dry_run:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  webhook_added:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  tags_pushed:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  image_built:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  manifest_pushed:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  failed_build: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  failed_manifest:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function hostFor(d: Deployment, env: string): string {
  const appName = d.repoSlug.replace(/_/g, "-");
  const base = d.domain && d.domain.trim()
    ? d.domain.trim()
    : `${appName}.${d.domainZone ?? "media-meter.in"}`;
  if (env === "production") return base;
  const dot = base.indexOf(".");
  if (dot === -1) return `${base}-staging`;
  return `${base.slice(0, dot)}-staging.${base.slice(dot + 1)}`;
}

export function DeploymentList() {
  const { data: deployments, mutate } = useSWR<Deployment[]>("/api/deployments");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Edited env_vars are keyed by deployment id; only the expanded row's
  // entry is mutated, but keeping them per-id means re-expanding the same
  // row preserves the admin's in-progress edits without persisting them.
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [activeEnvTab, setActiveEnvTab] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Seed the edit buffer the first time a row expands so the admin sees the
  // dev's submitted values, ready to overwrite.
  useEffect(() => {
    if (!expandedId || !deployments) return;
    if (edits[expandedId]) return;
    const d = deployments.find((x) => x._id === expandedId);
    if (!d) return;
    setEdits((prev) => ({ ...prev, [expandedId]: { ...(d.envVars ?? {}) } }));
    if (!activeEnvTab[expandedId] && d.environments.length > 0) {
      setActiveEnvTab((prev) => ({ ...prev, [expandedId]: d.environments[0] }));
    }
  }, [expandedId, deployments, edits, activeEnvTab]);

  const approveWithEdits = async (d: Deployment) => {
    setBusyId(d._id);
    setActionError("");
    try {
      const edited = edits[d._id];
      const body: Record<string, unknown> = {};
      if (edited && Object.keys(edited).length > 0) {
        // Send only the keys that actually differ — limits accidental writes
        // if the admin only meant to inspect.
        const diff: Record<string, string> = {};
        for (const env of d.environments) {
          const current = (d.envVars ?? {})[env] ?? "";
          const next = edited[env] ?? "";
          if (next !== current) diff[env] = next;
        }
        if (Object.keys(diff).length > 0) body.env_vars = diff;
      }
      const res = await apiFetch(`/api/deployments/${d._id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || "approve failed");
      }
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string, reason?: string) => {
    setBusyId(id);
    setActionError("");
    try {
      const res = await apiFetch(`/api/deployments/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "reject failed");
      }
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const copyTrack = async (d: Deployment) => {
    if (!d.trackUrl) return;
    const url = `${window.location.origin}${d.trackUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(d._id);
      setTimeout(() => setCopiedId((id) => (id === d._id ? null : id)), 1500);
    } catch {
      // Clipboard blocked — fall back to selecting the input visually
    }
  };

  if (!deployments || deployments.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        No deployment requests yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Recent Deployments</h3>
      {actionError && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {actionError}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-2 font-medium w-6"></th>
              <th className="pb-2 pr-4 font-medium">Repo</th>
              <th className="pb-2 pr-4 font-medium">Team</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Requested By</th>
              <th className="pb-2 pr-4 font-medium">Date</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((d) => {
              const pending = d.status === "pending_approval";
              const isExpanded = expandedId === d._id;
              const activeTab = activeEnvTab[d._id] ?? d.environments[0] ?? "";
              const editedValue =
                edits[d._id]?.[activeTab] ?? (d.envVars ?? {})[activeTab] ?? "";
              const submittedValue = (d.envVars ?? {})[activeTab] ?? "";
              const editorReadOnly = !pending;

              return (
                <Fragment key={d._id}>
                  <tr
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      setExpandedId((prev) => (prev === d._id ? null : d._id))
                    }
                  >
                    <td className="py-3 pr-2 text-muted-foreground">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">
                      {d.repoSlug}
                      {d.environments.length === 1 && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {d.environments[0]}
                        </span>
                      )}
                      {d.environments.length > 1 && (
                        <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {d.environments.join(" + ")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs">{d.team ?? "—"}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-lg border px-2 py-0.5 text-xs font-medium">
                        {KIND_LABELS[d.workloadKind] || d.workloadKind}
                        {d.role ? `/${d.role}` : ""}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-lg px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[d.status] || ""
                        }`}
                      >
                        {d.status}
                      </span>
                      {d.rejectionReason && (
                        <p className="mt-1 max-w-xs text-xs text-red-500">
                          {d.rejectionReason}
                        </p>
                      )}
                      {d.error && !d.rejectionReason && (
                        <p className="mt-1 text-xs text-red-500">{d.error}</p>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {d.requestedBy}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td
                      className="py-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {pending ? (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={busyId === d._id}
                            onClick={() => approveWithEdits(d)}
                            className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-400"
                          >
                            <Check className="h-3 w-3" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === d._id}
                            onClick={() => {
                              const reason = window.prompt(
                                "Reason for rejecting? (optional)"
                              );
                              if (reason === null) return;
                              reject(d._id, reason || undefined);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400"
                          >
                            <X className="h-3 w-3" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {d.approvedBy ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="space-y-4">
                          {/* Info grid */}
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-3 lg:grid-cols-4">
                            <Info label="Workload">
                              {d.workloadKind}
                              {d.role ? ` / ${d.role}` : ""}
                            </Info>
                            <Info label="Cluster">{d.cluster}</Info>
                            <Info label="Environments">
                              {d.environments.join(" + ") || "—"}
                            </Info>
                            <Info label="Port">{d.port ?? "—"}</Info>
                            <Info label="Domain zone">
                              {d.domainZone ?? "—"}
                            </Info>
                            <Info label="Repo URL">
                              <a
                                href={d.repoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-[#e8871e] hover:underline dark:text-[#5ab4c5]"
                              >
                                {d.repoSlug}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Info>
                            {d.manifestPath && (
                              <Info label="Manifest path">
                                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                                  {d.manifestPath}
                                </code>
                              </Info>
                            )}
                          </div>

                          {/* Hosts preview */}
                          {d.environments.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground">
                                Public hosts
                              </div>
                              <ul className="space-y-0.5">
                                {d.environments.map((env) => (
                                  <li
                                    key={env}
                                    className="font-mono text-[11px] text-foreground/80"
                                  >
                                    <span className="text-muted-foreground">
                                      {env}:
                                    </span>{" "}
                                    https://{hostFor(d, env)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Tracking link */}
                          {d.trackUrl && (
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground">
                                Tracking link (re-share with dev if lost)
                              </div>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                                  {typeof window !== "undefined"
                                    ? window.location.origin
                                    : ""}
                                  {d.trackUrl}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => copyTrack(d)}
                                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                                >
                                  {copiedId === d._id ? (
                                    <>
                                      <Check className="h-3 w-3" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      Copy
                                    </>
                                  )}
                                </button>
                                <a
                                  href={d.trackUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Open
                                </a>
                              </div>
                            </div>
                          )}

                          {/* Env vars editor — per-env tabs */}
                          {d.environments.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-xs font-medium text-muted-foreground">
                                  Env vars{" "}
                                  {pending ? (
                                    <span className="text-[10px] text-amber-600">
                                      (edits apply on Approve)
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">
                                      (read-only — already approved)
                                    </span>
                                  )}
                                </div>
                                {pending && editedValue !== submittedValue && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEdits((prev) => ({
                                        ...prev,
                                        [d._id]: { ...(d.envVars ?? {}) },
                                      }))
                                    }
                                    className="text-[10px] text-muted-foreground hover:underline"
                                  >
                                    revert
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center gap-1 border-b">
                                {d.environments.map((env) => (
                                  <button
                                    key={env}
                                    type="button"
                                    onClick={() =>
                                      setActiveEnvTab((prev) => ({
                                        ...prev,
                                        [d._id]: env,
                                      }))
                                    }
                                    className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                                      activeTab === env
                                        ? "border-[#e8871e] text-[#c2410c] dark:border-[#fbbf24] dark:text-[#fbbf24]"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                    }`}
                                  >
                                    {env}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                value={editedValue}
                                readOnly={editorReadOnly}
                                onChange={(e) =>
                                  setEdits((prev) => ({
                                    ...prev,
                                    [d._id]: {
                                      ...(prev[d._id] ?? d.envVars ?? {}),
                                      [activeTab]: e.target.value,
                                    },
                                  }))
                                }
                                placeholder={
                                  editorReadOnly
                                    ? "(no env vars)"
                                    : "KEY=VALUE per line"
                                }
                                rows={8}
                                className={`w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 ${
                                  editorReadOnly
                                    ? "cursor-not-allowed opacity-70"
                                    : ""
                                }`}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}
