"use client";

import useSWR from "swr";
import type { DashboardStats } from "@/types";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";

interface EndpointData {
  _id: string;
  name: string;
  uptimePercentage: number;
  lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
}

export function UptimeOverviewClient() {
  const endpointsKey = useFilteredKey("/api/endpoints");
  const statsKey = useFilteredKey("/api/stats");
  const { data: endpoints } = useSWR<EndpointData[]>(endpointsKey);
  const { data: stats } = useSWR<DashboardStats>(statsKey);

  if (!endpoints || !stats) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No endpoints to display
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall uptime */}
      <div className="rounded-xl bg-orange-50 p-4 dark:bg-[#164e63]/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[#8b3a0f] dark:text-[#5ab4c5]">
            Overall Uptime
          </span>
          <span className="text-2xl font-bold text-[#8b3a0f] dark:text-[#5ab4c5]">
            {stats.overallUptime.toFixed(1)}%
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-orange-200 dark:bg-[#0c2d3f]">
          <div
            className="h-full rounded-full bg-[#e8871e] transition-all dark:bg-[#2a7f9e]"
            style={{ width: `${Math.min(stats.overallUptime, 100)}%` }}
          />
        </div>
      </div>

      {/* Per-endpoint bars */}
      <div className="space-y-3">
        {endpoints.slice(0, 5).map((ep) => (
          <div key={ep._id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {ep.name.length > 25
                  ? ep.name.substring(0, 25) + "..."
                  : ep.name}
              </span>
              <span
                className={
                  ep.uptimePercentage >= 99
                    ? "text-[#e8871e] dark:text-[#5ab4c5]"
                    : ep.uptimePercentage >= 95
                    ? "text-[#f0a830] dark:text-[#b8e6ef]"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {ep.uptimePercentage.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  ep.uptimePercentage >= 99
                    ? "bg-[#e8871e] dark:bg-[#2a7f9e]"
                    : ep.uptimePercentage >= 95
                    ? "bg-[#f0a830] dark:bg-[#5ab4c5]"
                    : "bg-red-500"
                }`}
                style={{
                  width: `${Math.min(ep.uptimePercentage, 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
