"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, X } from "lucide-react";

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
  status: string;
  error: string | null;
  requestedBy: string;
  approvedBy?: string | null;
  rejectionReason?: string | null;
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
};

export function DeploymentList() {
  const { data: deployments, mutate } = useSWR<Deployment[]>("/api/deployments");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const act = async (
    id: string,
    action: "approve" | "reject",
    reason?: string
  ) => {
    setBusyId(id);
    setActionError("");
    try {
      const res = await apiFetch(`/api/deployments/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `${action} failed`);
      }
      await mutate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
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
              return (
                <tr key={d._id} className="border-b last:border-0">
                  <td className="py-3 pr-4 font-mono text-xs">{d.repoSlug}</td>
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
                  <td className="py-3">
                    {pending ? (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === d._id}
                          onClick={() => act(d._id, "approve")}
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
                            if (reason === null) return; // user cancelled
                            act(d._id, "reject", reason || undefined);
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
