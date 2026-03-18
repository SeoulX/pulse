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
  };
  onTogglePause?: (id: string, isActive: boolean) => void;
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
        <span className="text-sm text-muted-foreground">
          {endpoint.uptimePercentage.toFixed(2)}%
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
