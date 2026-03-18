"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const CHECK_INTERVAL = 60 * 1000; // 60 seconds

export function AutoChecker() {
  const { data: session } = useSession();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (session?.user?.role !== "admin") return;

    async function runChecks() {
      try {
        await fetch("/api/cron/trigger", { method: "POST" });
      } catch {
        // silently ignore — will retry next interval
      }
    }

    // Run immediately on mount
    runChecks();

    // Then every 60 seconds
    intervalRef.current = setInterval(runChecks, CHECK_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session]);

  return null;
}
