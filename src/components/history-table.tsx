"use client";

import useSWR from "swr";
import { StatusBadge } from "@/components/status-badge";

interface HistoryTableProps {
  endpointId: string;
}

export function HistoryTable({ endpointId }: HistoryTableProps) {
  const { data: results } = useSWR(
    `/api/endpoints/${endpointId}/history?limit=100`
  );

  if (!results) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        No check results yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Time</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-left font-medium">
              Response Time
            </th>
            <th className="px-4 py-3 text-left font-medium">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {results.map(
            (r: {
              _id: string;
              checkedAt: string;
              status: "UP" | "DOWN" | "DEGRADED";
              responseTime: number | null;
              error: string | null;
            }) => (
              <tr key={r._id} className="transition-colors hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(r.checkedAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  {r.responseTime != null ? `${r.responseTime}ms` : "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {r.error || "—"}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
