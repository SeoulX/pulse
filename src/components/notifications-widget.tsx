"use client";

import useSWR from "swr";
import { useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

type Filter = "all" | "alert" | "recovery";

interface Notification {
  _id: string;
  sentAt: string;
  endpointId: { name: string } | null;
  channel: string;
  type: string;
  status: string;
}

export function NotificationsWidget() {
  const { data: notifications } = useSWR<Notification[]>("/api/notifications");
  const [filter, setFilter] = useState<Filter>("all");

  if (!notifications) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const filtered =
    filter === "all"
      ? notifications
      : notifications.filter((n) => n.type === filter);

  return (
    <div className="flex h-full flex-col">
      {/* Filter tabs */}
      <div className="mb-4 flex gap-2">
        {(["all", "alert", "recovery"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium capitalize transition-all",
              filter === f
                ? "bg-[#e8871e] text-white shadow-sm dark:bg-[#2a7f9e]"
                : "border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No notifications
          </p>
        ) : (
          filtered.slice(0, 5).map((n) => (
            <div
              key={n._id}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`h-2 w-2 rounded-full ${
                    n.type === "alert" ? "bg-red-500" : "bg-[#e8871e] dark:bg-[#2a7f9e]"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium">
                    {n.endpointId?.name || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(n.sentAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  n.type === "alert"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-orange-100 text-[#8b3a0f] dark:bg-[#164e63]/30 dark:text-[#5ab4c5]"
                )}
              >
                {n.type}
              </span>
            </div>
          ))
        )}
      </div>

      {notifications.length > 5 && (
        <Link
          href="/dashboard/notifications"
          className="mt-3 block rounded-xl bg-[#1a1a1a] py-2 text-center text-xs font-medium text-white transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          View all notifications
        </Link>
      )}
    </div>
  );
}
