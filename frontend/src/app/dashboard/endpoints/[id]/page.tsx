"use client";

import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Pencil, Play, Pause } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { EndpointCharts } from "@/components/endpoint-charts";
import { HistoryTable } from "@/components/history-table";
import { ExportButtons } from "@/components/export-buttons";
import { DeleteEndpointDialog } from "@/components/delete-endpoint-dialog";
import { EndpointAIAnalysis } from "@/components/endpoint-ai-analysis";
import { DashboardHeader } from "@/components/dashboard-header";

export default function EndpointDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: endpoint, mutate } = useSWR(`/api/endpoints/${id}`);

  async function handleTogglePause() {
    if (!endpoint) return;
    await apiFetch(`/api/endpoints/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !endpoint.isActive }),
    });
    mutate();
  }

  if (!endpoint) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-2xl border bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="Endpoint Details" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="rounded-xl p-2 transition-colors hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h2 className="text-xl font-bold">{endpoint.name}</h2>
          <StatusBadge status={endpoint.lastStatus} />
          {!endpoint.isActive && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              PAUSED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleTogglePause}
            className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
          >
            {endpoint.isActive ? (
              <>
                <Pause className="h-4 w-4" /> Pause
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Resume
              </>
            )}
          </button>
          <ExportButtons endpointId={id} />
          <Link
            href={`/dashboard/endpoints/${id}/edit`}
            className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
          <DeleteEndpointDialog
            endpointId={id}
            endpointName={endpoint.name}
          />
        </div>
      </div>

      {/* Config Summary */}
      <div className="grid grid-cols-2 gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-5">
        <div>
          <p className="text-xs text-muted-foreground">Uptime</p>
          <p className="text-lg font-semibold">
            {endpoint.uptimePercentage.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Last Check</p>
          <p className="text-sm">
            {endpoint.lastCheckedAt
              ? new Date(endpoint.lastCheckedAt).toLocaleString()
              : "Never"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total Checks</p>
          <p className="text-lg font-semibold">{endpoint.totalChecks}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Method</p>
          <p className="text-sm font-medium">
            {endpoint.method} &rarr; {endpoint.expectedStatusCode}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Interval / Timeout</p>
          <p className="text-sm font-medium">
            {endpoint.interval}s / {endpoint.timeout}s
          </p>
        </div>
      </div>

      <p className="truncate text-sm text-muted-foreground">{endpoint.url}</p>

      {/* Charts */}
      <EndpointCharts endpointId={id} />

      {/* AI Analysis */}
      <EndpointAIAnalysis endpointId={id} />

      {/* History Table */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Check History</h2>
        <HistoryTable endpointId={id} />
      </div>
    </div>
  );
}
