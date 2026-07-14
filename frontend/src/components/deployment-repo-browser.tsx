"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, GitBranch, Search } from "lucide-react";

import { API_URL } from "@/lib/api";

interface RepoRow {
  repoSlug: string;
  latestStatus: string;
  latestEnv: string | null;
  latestTag: string | null;
  latestCluster: string;
  latestCreatedAt: string | null;
  latestTrackToken: string;
  total: number;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  failed_build:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  failed_manifest:
    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  pending_approval:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  building_image:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  pushing_manifest:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const _fmtDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function fmtAbs(iso: string | null): string {
  if (!iso) return "";
  return _fmtDate.format(new Date(iso)) + " PHT";
}
function fmtWhen(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Math.max(0, (Date.now() - then) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function DeploymentRepoBrowser() {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/deployments/repos?limit=50`);
        if (!res.ok) return;
        const rows = (await res.json()) as RepoRow[];
        if (!cancelled) setRepos(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return repos;
    const needle = q.toLowerCase();
    return repos.filter((r) => r.repoSlug.toLowerCase().includes(needle));
  }, [q, repos]);

  return (
    <section className="mt-8 rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-[#e8871e] dark:text-[#5ab4c5]" />
          <h2 className="text-sm font-semibold">Browse repositories</h2>
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {repos.length}
          </span>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter…"
            className="rounded-md border bg-background pl-6 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#e8871e]"
          />
        </div>
      </header>
      {loading ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">
          {q ? "No matches." : "No deployments yet."}
        </div>
      ) : (
        <ul className="divide-y">
          {filtered.map((r) => (
            <li key={r.repoSlug}>
              <Link
                href={`/deploy/repo/${r.repoSlug}`}
                className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="font-mono text-sm font-medium">
                  {r.repoSlug}
                </span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                    STATUS_STYLES[r.latestStatus] ??
                    "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.latestStatus}
                </span>
                {r.latestEnv && (
                  <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.latestEnv}
                  </span>
                )}
                <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {r.latestCluster}
                </span>
                <span
                  className="ml-auto text-[10px] text-muted-foreground"
                  title={fmtAbs(r.latestCreatedAt)}
                >
                  {r.total} build{r.total === 1 ? "" : "s"} · {fmtWhen(r.latestCreatedAt)}
                  {r.latestCreatedAt && (
                    <span className="ml-1 opacity-70">
                      ({fmtAbs(r.latestCreatedAt)})
                    </span>
                  )}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
