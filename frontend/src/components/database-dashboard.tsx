"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { apiFetch } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

interface DbEntry {
  key: string;
  label: string;
  kind: string;
  url_masked: string;
}

interface HistorySample {
  captured_at: string;
  status: "UP" | "DOWN" | "DEGRADED";
  response_time_ms: number;
  error: string | null;
  metrics: Record<string, number | null>;
}

interface DetailsSection {
  title: string;
  rows: Array<[string, string | number | null]>;
}

interface DetailsResponse {
  key: string;
  label: string;
  kind: string;
  sections: DetailsSection[];
}

// ── Chart-series definitions per kind ────────────────────────────────
//
// Pulled separately so the dashboard layout per protocol is declarative.
// Each chart pulls 1-3 metrics from the `metrics` dict on each sample
// and renders an area or line chart. `unit` is rendered after each y
// value in the tooltip.
type ChartType = "area" | "line";
interface ChartDef {
  title: string;
  type: ChartType;
  // Map of `series name → metrics key` pulled from each sample.
  series: Array<{ name: string; key: string; color: string }>;
  unit?: string;
}

const CHARTS_BY_KIND: Record<string, ChartDef[]> = {
  mongo: [
    { title: "Connections",          type: "area", series: [
      { name: "current", key: "connections_current", color: "#2a7f9e" },
      { name: "active",  key: "connections_active",  color: "#e8871e" },
    ]},
    { title: "Op counters (cumulative)", type: "line", series: [
      { name: "query",   key: "opcounters_query",   color: "#10b981" },
      { name: "insert",  key: "opcounters_insert",  color: "#3b82f6" },
      { name: "update",  key: "opcounters_update",  color: "#f59e0b" },
      { name: "delete",  key: "opcounters_delete",  color: "#ef4444" },
    ]},
    { title: "Resident memory", type: "area", series: [
      { name: "MiB", key: "mem_resident_mb", color: "#a855f7" },
    ], unit: " MiB" },
  ],
  redis: [
    { title: "Ops / sec",      type: "area", series: [
      { name: "ops/s", key: "ops_per_sec", color: "#2a7f9e" },
    ]},
    { title: "Used memory",    type: "area", series: [
      { name: "bytes", key: "used_memory_bytes", color: "#e8871e" },
    ], unit: " B" },
    { title: "Clients",        type: "line", series: [
      { name: "connected", key: "connected_clients", color: "#10b981" },
      { name: "blocked",   key: "blocked_clients",   color: "#ef4444" },
    ]},
    { title: "Keyspace",       type: "line", series: [
      { name: "hits",   key: "keyspace_hits",   color: "#10b981" },
      { name: "misses", key: "keyspace_misses", color: "#ef4444" },
    ]},
  ],
  elasticsearch: [
    { title: "Shards",            type: "area", series: [
      { name: "active",     key: "active_shards",     color: "#10b981" },
      { name: "unassigned", key: "unassigned_shards", color: "#ef4444" },
      { name: "relocating", key: "relocating_shards", color: "#f59e0b" },
    ]},
    { title: "Heap used %",       type: "line", series: [
      { name: "max", key: "heap_used_percent_max", color: "#e8871e" },
    ], unit: " %" },
    { title: "Active shards %",   type: "area", series: [
      { name: "pct", key: "active_shards_percent", color: "#2a7f9e" },
    ], unit: " %" },
  ],
  postgres: [
    { title: "Active backends",      type: "area", series: [
      { name: "backends", key: "backends", color: "#2a7f9e" },
    ]},
    { title: "Cache hit %",          type: "line", series: [
      { name: "hit %", key: "cache_hit_percent", color: "#10b981" },
    ], unit: " %" },
    { title: "Transactions (cumulative)", type: "line", series: [
      { name: "commit",   key: "xact_commit",   color: "#10b981" },
      { name: "rollback", key: "xact_rollback", color: "#ef4444" },
    ]},
    { title: "DB size",              type: "area", series: [
      { name: "bytes", key: "db_size_bytes", color: "#a855f7" },
    ], unit: " B" },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status?: HistorySample["status"] }) {
  if (!status) return null;
  const colors = {
    UP:       "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    DEGRADED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    DOWN:     "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  } as const;
  const Icon = status === "UP" ? CheckCircle2 : status === "DEGRADED" ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${colors[status]}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function fmtTick(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

// Convert array of HistorySample into recharts-friendly rows for a chart def.
function toChartData(samples: HistorySample[], def: ChartDef) {
  return samples.map((s) => {
    const row: Record<string, string | number | null> = { t: s.captured_at };
    for (const ser of def.series) {
      const v = (s.metrics || {})[ser.key];
      row[ser.name] = typeof v === "number" ? v : null;
    }
    return row;
  });
}

// ── Main component ───────────────────────────────────────────────────

export function DatabaseDashboard({ dbKey }: { dbKey: string }) {
  const [entry, setEntry] = useState<DbEntry | null>(null);
  const [details, setDetails] = useState<DetailsResponse | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  async function load(initial = false) {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const [invR, dR, hR] = await Promise.all([
        apiFetch("/api/databases"),
        apiFetch(`/api/databases/details/${dbKey}`),
        apiFetch(`/api/databases/history/${dbKey}?minutes=${minutes}`),
      ]);
      const inv = await invR.json();
      const det = await dR.json();
      const hist = await hR.json();
      if (!invR.ok || !dR.ok || !hR.ok) throw new Error(det.detail || hist.detail || "fetch failed");
      // Find the entry across all tabs.
      let found: DbEntry | null = null;
      for (const k of Object.keys(inv)) {
        for (const e of inv[k] || []) if (e.key === dbKey) found = e;
      }
      setEntry(found);
      setDetails(det);
      setHistory(hist.samples || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(true); /* eslint-disable-line */ }, [dbKey, minutes]);

  // Auto-refresh every 30s — gives a live dashboard feel without
  // hammering the backend (sampler runs at 60s anyway).
  useEffect(() => {
    const t = setInterval(() => load(false), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [dbKey, minutes]);

  if (loading) return <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Loading…</div>;
  if (error)   return <div className="rounded-2xl border border-red-300 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div>;

  const latest = history[history.length - 1];
  const kind = entry?.kind || details?.kind || "";
  const label = entry?.label || details?.label || dbKey;
  const chartDefs = [...(CHARTS_BY_KIND[kind] || [])];

  // Mongo: build dynamic per-member series. Sampler writes flat keys
  // of the form `member__<host>__<metric>`, one entry per member per
  // tick. Discover the member set from the latest sample, then emit
  // one chart per metric with members as parallel series.
  if (kind === "mongo" && latest && latest.metrics) {
    const members = new Set<string>();
    Object.keys(latest.metrics).forEach((k) => {
      const m = k.match(/^member__(.+?)__/);
      if (m) members.add(m[1]);
    });
    if (members.size > 0) {
      const memberList = Array.from(members).sort();
      const palette = ["#10b981", "#3b82f6", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4"];
      const perMemberCharts: Array<{ title: string; suffix: string; type: ChartType }> = [
        { title: "Connections — per member",        suffix: "connections_current", type: "area" },
        { title: "Op counters: query — per member", suffix: "opcounters_query",    type: "line" },
        { title: "Resident memory (MiB) — per member", suffix: "mem_resident_mb",  type: "area" },
        { title: "Replication lag (s) — per member", suffix: "lag_sec",            type: "line" },
      ];
      for (const pc of perMemberCharts) {
        chartDefs.push({
          title: pc.title,
          type: pc.type,
          series: memberList.map((m, i) => ({
            name: m,
            key: `member__${m}__${pc.suffix}`,
            color: palette[i % palette.length],
          })),
        });
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/databases" className="rounded-lg p-1.5 hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-lg font-medium">{label}</div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              {kind} · {dbKey}
            </div>
          </div>
          <StatusPill status={latest?.status} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-lg border bg-background px-2 py-1"
          >
            {[15, 60, 180, 360, 1440].map((m) => (
              <option key={m} value={m}>{m < 60 ? `${m}m` : `${m / 60}h`}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => load(false)}
            className="inline-flex items-center gap-1 rounded-lg border bg-card px-2 py-1 hover:bg-muted"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {entry && (
        <div className="rounded-2xl border bg-muted/20 px-4 py-2 font-mono text-[11px] text-muted-foreground break-all">
          {entry.url_masked}
        </div>
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status"           value={latest?.status ?? "—"} />
        <Stat label="Latency (last)"   value={latest ? `${latest.response_time_ms.toFixed(0)} ms` : "—"} />
        <Stat label="Samples"          value={history.length} />
        <Stat label="Window"           value={minutes < 60 ? `${minutes}m` : `${minutes / 60}h`} />
      </div>

      {/* Mongo replica-set panel — health banner + members table + lag
          bars. Matches the watch-tower streamlit layout (status at top,
          members with state/health/uptime, lag per secondary). */}
      {kind === "mongo" && latest?.metrics && (
        <MongoReplicaPanel sample={latest} />
      )}

      {/* Latency chart (universal) */}
      <ChartCard
        title="Latency"
        samples={history}
        def={{
          title: "Latency",
          type: "area",
          series: [{ name: "ms", key: "__latency__", color: "#2a7f9e" }],
          unit: " ms",
        }}
        // Special: latency comes from response_time_ms, not metrics.
        latencyOverride
      />

      {/* Per-kind charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {chartDefs.map((def) => (
          <ChartCard key={def.title} title={def.title} samples={history} def={def} />
        ))}
      </div>

      {/* Snapshot sections (current state) */}
      {details && details.sections.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-2 text-sm font-medium">Current snapshot</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {details.sections.map((sec, i) => (
              <div key={i} className="rounded-xl border bg-muted/30 p-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </div>
                <dl className="space-y-0.5 text-xs">
                  {sec.rows.map(([k, v], j) => (
                    <div key={j} className="flex items-start justify-between gap-3">
                      <dt className="font-mono text-muted-foreground break-all">{k}</dt>
                      <dd className="text-right font-mono break-all">{v === null || v === undefined ? "—" : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function ChartCard({
  title, samples, def, latencyOverride = false,
}: {
  title: string;
  samples: HistorySample[];
  def: ChartDef;
  latencyOverride?: boolean;
}) {
  const data = latencyOverride
    ? samples.map((s) => ({ t: s.captured_at, ms: s.response_time_ms }))
    : toChartData(samples, def);
  // Hide chart if every value in every series is null/empty (no data).
  const anyValue = data.some((row) =>
    def.series.some((s) => {
      const v = row[s.name];
      return typeof v === "number";
    })
  );
  const C = def.type === "area" ? AreaChart : LineChart;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {!anyValue ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          No data — sampler hasn&rsquo;t collected this metric yet.
        </div>
      ) : (
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <C data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.18)" />
              <XAxis dataKey="t" tickFormatter={fmtTick} fontSize={10} tick={{ fill: "#94a3b8" }} />
              <YAxis fontSize={10} tick={{ fill: "#94a3b8" }} width={48} />
              <Tooltip
                labelFormatter={(v) => new Date(String(v)).toLocaleString()}
                formatter={(value: unknown) =>
                  typeof value === "number" ? value.toLocaleString() + (def.unit ?? "") : "—"
                }
                contentStyle={{ background: "rgba(20,20,20,0.9)", border: "1px solid #444", borderRadius: 8, fontSize: 12 }}
              />
              {def.series.map((ser) =>
                def.type === "area" ? (
                  <Area key={ser.name} type="monotone" dataKey={ser.name} stroke={ser.color} fill={ser.color} fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} />
                ) : (
                  <Line key={ser.name} type="monotone" dataKey={ser.name} stroke={ser.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                )
              )}
            </C>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}


// ── Mongo replica-set panel ─────────────────────────────────────────
//
// Reads per-member keys from the latest sample's `metrics` dict:
//   member__<host>__state         PRIMARY / SECONDARY / ARBITER / DOWN
//   member__<host>__health        0 | 1
//   member__<host>__lag_sec       float  (secondaries only)
//   member__<host>__connections_current
//   member__<host>__uptime_seconds
//
// Renders a watch-tower-style:
//   1. cluster-health banner (Healthy / NO PRIMARY / Degraded)
//   2. members table with status emoji + role + health + uptime + lag
//   3. lag bar (color-graded green→yellow→red) per secondary

interface MongoMember {
  host: string;
  state: string;
  health: number;
  lag_sec: number | null;
  connections: number | null;
  uptime_seconds: number | null;
}

function extractMongoMembers(metrics: Record<string, number | null>): MongoMember[] {
  const byHost: Record<string, Partial<MongoMember>> = {};
  for (const [k, v] of Object.entries(metrics || {})) {
    const m = k.match(/^member__(.+?)__(.+)$/);
    if (!m) continue;
    const [, host, suffix] = m;
    byHost[host] = byHost[host] || { host };
    if (suffix === "state")              byHost[host].state = (v as unknown as string) ?? "";
    else if (suffix === "health")        byHost[host].health = Number(v ?? 0);
    else if (suffix === "lag_sec")       byHost[host].lag_sec = typeof v === "number" ? v : null;
    else if (suffix === "connections_current") byHost[host].connections = typeof v === "number" ? v : null;
    else if (suffix === "uptime_seconds") byHost[host].uptime_seconds = typeof v === "number" ? v : null;
  }
  // Stable order: PRIMARY first, then SECONDARY by host, then ARBITER, then anything else.
  const stateRank = (s?: string) =>
    s === "PRIMARY" ? 0 : s === "SECONDARY" ? 1 : s === "ARBITER" ? 2 : 3;
  return Object.values(byHost)
    .map((m) => ({
      host:           m.host || "?",
      state:          m.state || "",
      health:         m.health ?? 0,
      lag_sec:        m.lag_sec ?? null,
      connections:    m.connections ?? null,
      uptime_seconds: m.uptime_seconds ?? null,
    }))
    .sort((a, b) => {
      const r = stateRank(a.state) - stateRank(b.state);
      return r !== 0 ? r : a.host.localeCompare(b.host);
    });
}

function fmtUptime(secs: number | null): string {
  if (!secs || secs <= 0) return "—";
  if (secs < 3600)  return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

function MongoReplicaPanel({ sample }: { sample: HistorySample }) {
  const members = extractMongoMembers(sample.metrics);
  if (members.length === 0) return null;

  const primaries = members.filter((m) => m.state === "PRIMARY");
  const healthy = members.filter((m) => m.health === 1).length;
  const total = members.length;
  const primary = primaries[0];

  let bannerCls = "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300";
  let bannerLabel = `✅ Cluster Healthy — ${healthy}/${total} nodes up · PRIMARY: ${primary?.host}`;
  if (primaries.length === 0) {
    bannerCls = "border-red-300 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300";
    bannerLabel = "🚨 NO PRIMARY — Cluster is down or in election";
  } else if (healthy < total) {
    bannerCls = "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300";
    bannerLabel = `⚠️ Degraded — ${healthy}/${total} nodes up · PRIMARY: ${primary?.host}`;
  }

  const secondaries = members.filter((m) => m.state === "SECONDARY");
  const maxLag = Math.max(1, ...secondaries.map((m) => m.lag_sec ?? 0));

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-medium">Replica set</h2>

      <div className={`mb-4 rounded-xl border px-3 py-2 text-sm font-medium ${bannerCls}`}>
        {bannerLabel}
      </div>

      {/* Members table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Status</th>
              <th className="px-2 py-1.5 text-left">Node</th>
              <th className="px-2 py-1.5 text-left">State</th>
              <th className="px-2 py-1.5 text-left">Health</th>
              <th className="px-2 py-1.5 text-left">Connections</th>
              <th className="px-2 py-1.5 text-left">Uptime</th>
              <th className="px-2 py-1.5 text-left">Lag</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const icon =
                m.state === "PRIMARY" && m.health === 1 ? "🟢" :
                m.state === "SECONDARY" && m.health === 1 ? "🔵" :
                m.state === "ARBITER" && m.health === 1 ? "🟣" :
                m.health === 1 ? "🟡" : "🔴";
              const lagDisplay = m.state === "PRIMARY" || m.state === "ARBITER"
                ? "—"
                : m.lag_sec === null ? "?"
                : `${m.lag_sec.toFixed(1)}s`;
              return (
                <tr key={m.host} className="border-b last:border-0">
                  <td className="px-2 py-1.5 text-base">{icon}</td>
                  <td className="px-2 py-1.5 font-mono">{m.host}</td>
                  <td className="px-2 py-1.5 font-mono uppercase">{m.state || "—"}</td>
                  <td className={`px-2 py-1.5 font-medium ${m.health === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {m.health === 1 ? "UP" : "DOWN"}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{m.connections ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono">{fmtUptime(m.uptime_seconds)}</td>
                  <td className="px-2 py-1.5 font-mono">{lagDisplay}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Lag bars per secondary */}
      {secondaries.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-muted-foreground">Replication lag (secondaries)</div>
          <div className="space-y-1">
            {secondaries.map((m) => {
              const lag = m.lag_sec ?? 0;
              const pct = Math.min(100, (lag / Math.max(maxLag, 10)) * 100);
              const color =
                lag <= 1   ? "bg-emerald-500" :
                lag <= 10  ? "bg-amber-500"   :
                             "bg-red-500";
              return (
                <div key={m.host} className="flex items-center gap-2 text-xs">
                  <div className="w-32 font-mono">{m.host}</div>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-14 text-right font-mono">{lag.toFixed(1)}s</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
