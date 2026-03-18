"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Pause, Play, Pencil, AlertTriangle } from "lucide-react";

interface EndpointCardProps {
  endpoint: {
    _id: string;
    name: string;
    url: string;
    isActive: boolean;
    lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
    lastResponseTime: number | null;
    uptimePercentage: number;
    isAlerting: boolean;
    consecutiveFailures: number;
    createdAt: string;
    lastCheckedAt: string | null;
  };
  onTogglePause?: (id: string, isActive: boolean) => void;
}

function formatUptime(createdAt: string, lastCheckedAt: string | null): string {
  if (!lastCheckedAt) return "—";
  const start = new Date(createdAt).getTime();
  const last = new Date(lastCheckedAt).getTime();
  const diffSec = Math.floor((last - start) / 1000);
  if (diffSec < 0) return "—";
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    const remMin = diffMin % 60;
    return remMin > 0 ? `${diffHr}h ${remMin}m` : `${diffHr}h`;
  }
  const diffDay = Math.floor(diffHr / 24);
  const remHr = diffHr % 24;
  return remHr > 0 ? `${diffDay}d ${remHr}h` : `${diffDay}d`;
}

export function EndpointCard({ endpoint, onTogglePause }: EndpointCardProps) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between">
        <Link
          href={`/dashboard/endpoints/${endpoint._id}`}
          className="flex-1"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{endpoint.name}</h3>
            {endpoint.isAlerting && (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {endpoint.url}
          </p>
        </Link>

        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              onTogglePause?.(endpoint._id, !endpoint.isActive)
            }
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
            title={endpoint.isActive ? "Pause" : "Resume"}
          >
            {endpoint.isActive ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <Link
            href={`/dashboard/endpoints/${endpoint._id}/edit`}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <StatusBadge status={endpoint.lastStatus} />
        <span className="text-sm text-muted-foreground">
          {endpoint.lastResponseTime != null
            ? `${endpoint.lastResponseTime}ms`
            : "—"}
        </span>
        <span className="text-sm text-muted-foreground" title={`${endpoint.uptimePercentage.toFixed(2)}% uptime`}>
          {formatUptime(endpoint.createdAt, endpoint.lastCheckedAt)} up
        </span>
        {endpoint.isAlerting && (
          <span className="text-xs text-red-500">
            {endpoint.consecutiveFailures} failures
          </span>
        )}
      </div>
    </div>
  );
}
