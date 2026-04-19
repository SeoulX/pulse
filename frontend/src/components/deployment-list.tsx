"use client";

import useSWR from "swr";

interface Deployment {
  _id: string;
  repoSlug: string;
  repoUrl: string;
  workloadKind: string;
  status: string;
  error: string | null;
  requestedBy: string;
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
  pending:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  webhook_added:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export function DeploymentList() {
  const { data: deployments } = useSWR<Deployment[]>("/api/deployments");

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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Repo</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Requested By</th>
              <th className="pb-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((d) => (
              <tr key={d._id} className="border-b last:border-0">
                <td className="py-3 pr-4 font-mono text-xs">{d.repoSlug}</td>
                <td className="py-3 pr-4">
                  <span className="rounded-lg border px-2 py-0.5 text-xs font-medium">
                    {KIND_LABELS[d.workloadKind] || d.workloadKind}
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
                  {d.error && (
                    <p className="mt-1 text-xs text-red-500">{d.error}</p>
                  )}
                </td>
                <td className="py-3 pr-4 text-muted-foreground">
                  {d.requestedBy}
                </td>
                <td className="py-3 text-muted-foreground">
                  {new Date(d.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
