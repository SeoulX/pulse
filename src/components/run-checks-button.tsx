"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { RefreshCw } from "lucide-react";

export function RunChecksButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { mutate } = useSWRConfig();

  async function handleRun() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/cron/trigger", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult(`Checked ${data.checked} endpoints`);
        mutate(() => true);
      } else {
        setResult(data.error || "Failed");
      }
    } catch {
      setResult("Error running checks");
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 3000);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleRun}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-all hover:bg-muted disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Checking..." : "Run Checks"}
      </button>
      {result && (
        <div className="absolute right-0 top-full z-10 mt-2 whitespace-nowrap rounded-xl border bg-card px-3 py-2 text-xs shadow-lg">
          {result}
        </div>
      )}
    </div>
  );
}
