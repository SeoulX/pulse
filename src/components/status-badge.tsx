import { cn } from "@/lib/utils";
import type { EndpointStatus } from "@/types";

const statusConfig: Record<
  EndpointStatus,
  { label: string; className: string; dotColor: string; pulseColor: string }
> = {
  UP: {
    label: "UP",
    className: "bg-orange-100 text-[#8b3a0f] dark:bg-[#164e63]/30 dark:text-[#5ab4c5]",
    dotColor: "bg-emerald-500",
    pulseColor: "bg-emerald-400",
  },
  DOWN: {
    label: "DOWN",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    dotColor: "bg-red-500",
    pulseColor: "bg-red-400",
  },
  DEGRADED: {
    label: "DEGRADED",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    dotColor: "bg-yellow-500",
    pulseColor: "bg-yellow-400",
  },
};

export function StatusBadge({ status }: { status: EndpointStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        PENDING
      </span>
    );
  }

  const config = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            config.pulseColor
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            config.dotColor
          )}
        />
      </span>
      {config.label}
    </span>
  );
}
