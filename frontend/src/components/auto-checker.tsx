"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth-context";
import { apiFetch } from "@/lib/api";

const CHECK_INTERVAL = 60 * 1000; // 60 seconds

export function AutoChecker() {
  const { user } = useAuth();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (user?.role !== "admin") return;

    async function runChecks() {
      try {
        await apiFetch("/api/cron/trigger", { method: "POST" });
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
  }, [user]);

  return null;
}
