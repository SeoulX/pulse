"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Tag as TagIcon,
  X,
} from "lucide-react";

import { API_URL, apiFetch, getToken } from "@/lib/api";

interface Build {
  repoSlug: string;
  team: string;
  workloadKind: string;
  role: string | null;
  cluster: string;
  environments: string[];
  status: string;
  trackToken: string;
  createdAt: string;
  attempt: number;
  latestBuildId: string | null;
  latestJenkinsBuildUrl: string | null;
  tag: string | null;
  origin: string;
}

interface Response {
  repoSlug: string;
  count: number;
  builds: Build[];
}

const POLL_MS = 10_000;
const TERMINAL = new Set([
  "completed",
  "failed",
  "failed_build",
  "failed_manifest",
  "rejected",
]);

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  failed_build:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  failed_manifest:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  pending_approval:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  building_image:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pushing_manifest:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, (Date.now() - then) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed")
    return <Check className="h-3.5 w-3.5 text-green-600" />;
  if (
    status === "failed" ||
    status === "failed_build" ||
    status === "failed_manifest" ||
    status === "rejected"
  )
    return <X className="h-3.5 w-3.5 text-red-600" />;
  if (TERMINAL.has(status)) return null;
  return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
}

export default function RepoBuildsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (): Promise<Response | null> => {
    if (!slug) return null;
    try {
      const res = await fetch(
        `${API_URL}/api/deployments/repo/${slug}?limit=100`,
      );
      if (!res.ok) return null;
      return (await res.json()) as Response;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      const r = await load();
      if (cancelled) return;
      if (r) {
        setData(r);
        setLoading(false);
      } else {
        setLoading(false);
      }
      // Keep polling if ANY build is still in flight so the row status
      // updates without a manual refresh.
      const stillLive = r?.builds.some((b) => !TERMINAL.has(b.status));
      if (stillLive) timer = setTimeout(loop, POLL_MS);
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  const manualRefresh = async () => {
    setRefreshing(true);
    const r = await load();
    if (r) setData(r);
    setRefreshing(false);
  };

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string>("");
  const canBackfill = typeof window !== "undefined" && !!getToken();

  const runBackfill = async () => {
    if (!slug) return;
    setBackfilling(true);
    setBackfillMsg("");
    try {
      const res = await apiFetch(
        `/api/deployments/repo/${slug}/backfill`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBackfillMsg(body.detail ?? `HTTP ${res.status}`);
      } else {
        setBackfillMsg(
          `+${body.inserted} inserted (${body.skipped} skipped of ${body.totalTags} tags)`,
        );
        const r = await load();
        if (r) setData(r);
      }
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="dot-grid min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/deploy"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            {backfillMsg && (
              <span className="text-[11px] text-muted-foreground">
                {backfillMsg}
              </span>
            )}
            {canBackfill && (
              <button
                type="button"
                onClick={runBackfill}
                disabled={backfilling}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                title="Admin only. Pulls all Bitbucket tags for this repo and inserts synthetic manual_tag records."
              >
                <Download
                  className={`h-3.5 w-3.5 ${backfilling ? "animate-pulse" : ""}`}
                />
                Backfill from Bitbucket
              </button>
            )}
            <button
              type="button"
              onClick={manualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-4">
          <h1 className="font-mono text-xl font-semibold">{slug}</h1>
          <p className="text-xs text-muted-foreground">
            {data?.count ?? 0} build{data?.count === 1 ? "" : "s"} · polling
            every {POLL_MS / 1000}s while any is live
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center rounded-2xl border bg-card p-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {!loading && data && data.builds.length === 0 && (
          <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No builds recorded for this repo yet.
          </div>
        )}

        {!loading && data && data.builds.length > 0 && (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Tag</th>
                  <th className="px-4 py-2 text-left font-medium">Env</th>
                  <th className="px-4 py-2 text-left font-medium">Cluster</th>
                  <th className="px-4 py-2 text-left font-medium">Attempt</th>
                  <th className="px-4 py-2 text-left font-medium">Origin</th>
                  <th className="px-4 py-2 text-left font-medium">When</th>
                  <th className="px-4 py-2 text-right font-medium">Jenkins</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.builds.map((b) => {
                  const env = b.environments[0] ?? "-";
                  return (
                    <tr key={b.trackToken} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Link
                          href={`/deploy/track/${b.trackToken}`}
                          className="flex items-center gap-2"
                        >
                          <StatusIcon status={b.status} />
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                              STATUS_STYLES[b.status] ??
                              "bg-muted text-muted-foreground"
                            }`}
                          >
                            {b.status}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/deploy/track/${b.trackToken}`}
                          className="flex items-center gap-1 font-mono text-xs"
                        >
                          {b.tag ? (
                            <>
                              <TagIcon className="h-3 w-3 text-muted-foreground" />
                              {b.tag}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {env}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {b.cluster}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {b.attempt}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                            b.origin === "manual_tag"
                              ? "text-[#e8871e] dark:text-[#5ab4c5]"
                              : "text-muted-foreground"
                          }`}
                        >
                          {b.origin === "manual_tag" ? "manual" : "form"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {fmtWhen(b.createdAt)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {b.latestJenkinsBuildUrl && (
                          <a
                            href={b.latestJenkinsBuildUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-[#e8871e] dark:hover:text-[#5ab4c5]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                            #{b.latestBuildId ?? "?"}
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
