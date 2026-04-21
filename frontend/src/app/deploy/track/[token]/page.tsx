"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { RefreshCw, ArrowLeft } from "lucide-react";

import { API_URL } from "@/lib/api";
import {
  DeploymentProgressCard,
  type ProgressCardData,
} from "@/components/deployment-progress";

const POLL_MS = 5000;
const TERMINAL = new Set(["completed", "failed"]);

interface TrackResponse extends ProgressCardData {
  trackToken: string;
}

export default function TrackDeploymentPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<TrackResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch(`${API_URL}/api/deployments/track/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as TrackResponse;
        if (!cancelled) {
          setData(json);
          setError("");
        }
        return json;
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
        return null;
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const json = await fetchOnce();
      if (cancelled) return;
      if (json && !TERMINAL.has(json.status)) {
        timer = setTimeout(loop, POLL_MS);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  const manualRefresh = async () => {
    if (!token || refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/api/deployments/track/${token}`);
      if (res.ok) {
        setData((await res.json()) as TrackResponse);
        setError("");
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? `HTTP ${res.status}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="dot-grid min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/deploy"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Submit another
          </Link>
          <button
            type="button"
            onClick={manualRefresh}
            disabled={refreshing || !data}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h1 className="text-lg font-semibold">Deployment progress</h1>
            <p className="text-xs text-muted-foreground">
              Polling every {POLL_MS / 1000}s while this request is in flight.
              Bookmark this page — the link never expires.
            </p>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {!loading && !error && data && <DeploymentProgressCard data={data} />}
        </div>
      </div>
    </div>
  );
}
