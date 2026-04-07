"use client";

import useSWR from "swr";
import Link from "next/link";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";

interface EndpointData {
  _id: string;
  name: string;
  lastResponseTime: number | null;
  lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
  uptimePercentage: number;
}

const statusStyles = {
  UP: "bg-orange-100 text-[#8b3a0f] dark:bg-[#164e63]/30 dark:text-[#5ab4c5]",
  DOWN: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  DEGRADED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
};

export function RecentChecksWidget() {
  const endpointsKey = useFilteredKey("/api/endpoints");
  const { data: endpoints } = useSWR<EndpointData[]>(endpointsKey);

  if (!endpoints) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No endpoints yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {endpoints.slice(0, 6).map((ep) => (
        <Link
          key={ep._id}
          href={`/dashboard/endpoints/${ep._id}`}
          className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
        >
          <div className="flex items-center gap-3">
            <div
              className={`h-2 w-2 rounded-full ${
                ep.lastStatus === "UP"
                  ? "bg-[#e8871e] dark:bg-[#2a7f9e]"
                  : ep.lastStatus === "DOWN"
                  ? "bg-red-500"
                  : ep.lastStatus === "DEGRADED"
                  ? "bg-[#f0a830] dark:bg-[#5ab4c5]"
                  : "bg-gray-400"
              }`}
            />
            <span className="text-sm font-medium">
              {ep.name.length > 20 ? ep.name.substring(0, 20) + "..." : ep.name}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                ep.lastStatus ? statusStyles[ep.lastStatus] : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
              }`}
            >
              {ep.lastStatus || "PENDING"}
            </span>
            <span className="text-xs text-muted-foreground">
              {ep.lastResponseTime != null ? `${ep.lastResponseTime}ms` : "—"}
            </span>
          </div>
        </Link>
      ))}
      {endpoints.length > 6 && (
        <Link
          href="/dashboard"
          className="mt-2 text-center text-xs font-medium text-[#e8871e] hover:text-[#c45e1a] dark:text-[#5ab4c5] dark:hover:text-[#7bcfe0]"
        >
          View all endpoints
        </Link>
      )}
    </div>
  );
}
