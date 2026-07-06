"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Database, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";


interface DbEntry {
  key: string;          // env-var key, e.g. MONGODB_URI
  label: string;        // friendly name, e.g. "MongoDB primary"
  kind: string;         // mongo | redis | elasticsearch | postgres
  url_masked: string;   // creds redacted
}

interface ProbeResult {
  status: "UP" | "DOWN" | "DEGRADED";
  status_code: number | null;
  response_time: number;  // ms
  error: string | null;
}

// Tab order locked to the scope the team picked: mongo, redis, ES, pg.
// MinIO + ClickHouse exist in devops-global-secrets but are out of scope
// for now — see manComm/05-19-26/MARK-db-metrics.md.
const TABS: Array<{ kind: string; label: string }> = [
  { kind: "mongo",         label: "MongoDB" },
  { kind: "redis",         label: "Redis" },
  { kind: "elasticsearch", label: "Elasticsearch" },
  { kind: "postgres",      label: "Postgres" },
];

function StatusPill({ result }: { result?: ProbeResult }) {
  if (!result) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        unknown
      </span>
    );
  }
  const colors = {
    UP:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    DEGRADED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    DOWN:     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  } as const;
  const Icon = result.status === "UP" ? CheckCircle2 : result.status === "DEGRADED" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${colors[result.status]}`}>
      <Icon className="h-3 w-3" />
      {result.status}
    </span>
  );
}

export function DatabasesView() {
  const [inventory, setInventory] = useState<Record<string, DbEntry[]>>({});
  const [activeKind, setActiveKind] = useState(TABS[0].kind);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch("/api/databases");
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "Failed to load inventory");
        setInventory(data);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function probe(entry: DbEntry) {
    setProbing((p) => ({ ...p, [entry.key]: true }));
    try {
      const r = await apiFetch(`/api/databases/probe/${entry.key}`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "probe failed");
      setResults((rs) => ({ ...rs, [entry.key]: data }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResults((rs) => ({ ...rs, [entry.key]: { status: "DOWN", status_code: null, response_time: 0, error: msg } }));
    } finally {
      setProbing((p) => ({ ...p, [entry.key]: false }));
    }
  }

  async function probeAll() {
    const entries = inventory[activeKind] || [];
    await Promise.all(entries.map((e) => probe(e)));
  }

  if (loading) return <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Loading inventory…</div>;
  if (error)   return <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div>;

  const active = inventory[activeKind] || [];

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b">
        {TABS.map((t) => {
          const count = (inventory[t.kind] || []).length;
          const isActive = t.kind === activeKind;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setActiveKind(t.kind)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-[#e8871e] text-[#c2410c] dark:border-[#fbbf24] dark:text-[#fbbf24]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${isActive ? "bg-[#e8871e]/15 dark:bg-[#fbbf24]/15" : "bg-muted"}`}>{count}</span>
            </button>
          );
        })}
        <div className="ml-auto pb-1">
          <button
            type="button"
            onClick={probeAll}
            disabled={active.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            Probe all
          </button>
        </div>
      </div>

      {/* Card grid */}
      {active.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-6 text-sm text-muted-foreground">
          No <span className="font-mono">{activeKind}</span> URIs discovered.
          Check that <code className="rounded bg-card px-1 font-mono text-xs">devops-global-secrets</code> is envFrom&apos;d into pulse-api.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {active.map((entry) => {
            const result = results[entry.key];
            const isProbing = probing[entry.key];
            return (
              <Link
                key={entry.key}
                href={`/dashboard/databases/${entry.key}`}
                className="group block rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{entry.label}</span>
                  </div>
                  <StatusPill result={result} />
                </div>
                <div className="mt-2 font-mono text-[11px] text-muted-foreground break-all">
                  {entry.url_masked}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {result ? (
                      <>
                        {result.response_time} ms
                        {result.error ? <span className="ml-2 text-amber-600 dark:text-amber-400">· {result.error.slice(0, 60)}</span> : null}
                      </>
                    ) : (
                      "Click to open dashboard"
                    )}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* Stop propagation so the Probe button doesn't navigate. */}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); probe(entry); }}
                      disabled={isProbing}
                      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3 w-3 ${isProbing ? "animate-spin" : ""}`} />
                      {isProbing ? "Probing…" : "Quick probe"}
                    </button>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

    </div>
  );
}
