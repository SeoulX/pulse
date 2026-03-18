"use client";

import useSWR from "swr";

export function NotificationLog() {
  const { data: notifications } = useSWR("/api/notifications");

  if (!notifications) {
    return (
      <div className="h-32 animate-pulse rounded-2xl border bg-muted" />
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-12 text-center shadow-sm">
        <p className="text-muted-foreground">No notifications yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Time</th>
            <th className="px-4 py-3 text-left font-medium">Endpoint</th>
            <th className="px-4 py-3 text-left font-medium">Channel</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {notifications.map(
            (n: {
              _id: string;
              sentAt: string;
              endpointId: { name: string } | null;
              channel: string;
              type: string;
              status: string;
            }) => (
              <tr key={n._id} className="transition-colors hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(n.sentAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {n.endpointId?.name || "Unknown"}
                </td>
                <td className="px-4 py-3 capitalize">{n.channel}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      n.type === "alert"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-orange-100 text-[#8b3a0f] dark:bg-[#164e63]/30 dark:text-[#5ab4c5]"
                    }`}
                  >
                    {n.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      n.status === "sent"
                        ? "text-[#e8871e] dark:text-[#5ab4c5]"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {n.status}
                  </span>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
