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
const TERMINAL = new Set([
  "completed",
  "failed",
  "failed_build",
  "failed_manifest",
  "rejected",
]);

// SEV: track endpoint returns { records: [...] }. Each record is one env.
// We merge them into a single ProgressCardData so the existing per-env
// renderer keeps working — but each env's status comes straight from its
// own independent record, no aggregate synthesis.
interface TrackResponse {
  primaryToken: string;
  submissionId: string | null;
  records: (ProgressCardData & { trackToken: string })[];
}

function mergeRecords(resp: TrackResponse): ProgressCardData | null {
  if (!resp.records || resp.records.length === 0) return null;
  if (resp.records.length === 1) return resp.records[0];
  // Multi-record (SEV multi-env): synthesize a combined view. Each env's
  // status comes from its own record — no cross-record arithmetic.
  const envStatuses: Record<string, string> = {};
  const envErrors: Record<string, string> = {};
  const argocdLinks: Record<string, string> = {};
  const environments: string[] = [];
  for (const r of resp.records) {
    const env = r.environments[0];
    if (!env) continue;
    environments.push(env);
    envStatuses[env] = r.status;
    if (r.error) envErrors[env] = r.error;
    const link = r.argocdLinks?.[env];
    if (link) argocdLinks[env] = link;
  }
  const first = resp.records[0];
  // Aggregate-display only (no write-path use): worst phase across envs so
  // the top-right summary chip reflects the lagging env. Failures rank
  // highest, completed lowest — done in the renderer already; here we
  // just pick something reasonable for `data.status`.
  const phase: Record<string, number> = {
    pending_approval: 0, pending: 0,
    approved: 1, dry_run: 1,
    webhook_added: 2, tags_pushed: 3,
    image_built: 4, manifest_pushed: 5,
    completed: 6,
    failed: 10, failed_build: 11, failed_manifest: 12, rejected: 13,
  };
  const statuses = Object.values(envStatuses);
  const failures = statuses.filter((s) => phase[s] >= 10);
  let displayStatus: string;
  if (failures.length > 0) {
    displayStatus = failures.reduce((a, b) => (phase[a] >= phase[b] ? a : b));
  } else if (
    statuses.length === environments.length &&
    statuses.every((s) => s === "completed")
  ) {
    displayStatus = "completed";
  } else {
    displayStatus = statuses.reduce((a, b) =>
      (phase[a] ?? 0) <= (phase[b] ?? 0) ? a : b
    );
  }

  return {
    ...first,
    environments,
    envStatuses,
    envErrors,
    argocdLinks,
    status: displayStatus,
    error: null,
  };
}

function allEnvsTerminal(merged: ProgressCardData): boolean {
  const envStatuses = merged.envStatuses ?? {};
  const envs = merged.environments ?? [];
  if (envs.length === 0 || Object.keys(envStatuses).length === 0) {
    return TERMINAL.has(merged.status);
  }
  return envs.every((e) => TERMINAL.has(envStatuses[e] ?? ""));
}

export default function TrackDeploymentPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<ProgressCardData | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function fetchOnce(): Promise<ProgressCardData | null> {
      try {
        const res = await fetch(`${API_URL}/api/deployments/track/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        const raw = await res.json();
        // SEV: response is { records: [...] }. Older deployments without
        // submission_id still come back via this shape with a single
        // record, so the merge works uniformly.
        const merged = mergeRecords(raw as TrackResponse);
        if (!cancelled && merged) {
          setData(merged);
          setError("");
        }
        return merged;
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
      const merged = await fetchOnce();
      if (cancelled) return;
      if (merged && !allEnvsTerminal(merged)) {
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
        const merged = mergeRecords((await res.json()) as TrackResponse);
        if (merged) setData(merged);
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
