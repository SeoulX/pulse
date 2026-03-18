import { cn } from "@/lib/utils";
import type { EndpointStatus } from "@/types";

const statusConfig: Record<
  EndpointStatus,
  { label: string; className: string }
> = {
  UP: {
    label: "UP",
    className: "bg-orange-100 text-[#8b3a0f] dark:bg-[#164e63]/30 dark:text-[#5ab4c5]",
  },
  DOWN: {
    label: "DOWN",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  DEGRADED: {
    label: "DEGRADED",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
};

export function StatusBadge({ status }: { status: EndpointStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        PENDING
      </span>
    );
  }

  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
