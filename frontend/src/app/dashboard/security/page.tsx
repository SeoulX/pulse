"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Play,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";

import { apiFetch } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types (mirror api/handlers/security.py serializers)
// ---------------------------------------------------------------------------

interface ScanTarget {
  kind: string;
  ref: string | null;
  label: string;
  url: string;
}

interface Finding {
  ruleId: string;
  severity: string;
  title: string;
  detail: string;
  evidence: string | null;
  remediation: string;
  engine: string;
}

interface Scan {
  _id: string;
  targetKind: string;
  targetLabel: string;
  targetUrl: string;
  engine: string;
  profile?: string;
  status: string;
  error: string | null;
  severityCounts: Record<string, number>;
  topSeverity: string | null;
  requestedBy: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  findingCount: number;
  findings?: Finding[];
}

const SEV_STYLE: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-500/90 text-white",
  medium: "bg-amber-500 text-black",
  low: "bg-yellow-400 text-black",
  info: "bg-slate-400 text-black",
};

const SEV_ORDER = ["critical", "high", "medium", "low", "info"];

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------

export default function SecurityPage() {
  const [targets, setTargets] = useState<ScanTarget[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string>("");
  const [engine, setEngine] = useState<"passive" | "nuclei" | "zap">("passive");
  const [profile, setProfile] = useState<"fast" | "deep">("fast");
  const [authHeader, setAuthHeader] = useState("");
  const [launching, setLaunching] = useState(false);
  const [detail, setDetail] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        apiFetch("/api/security/targets"),
        apiFetch("/api/security/scans"),
      ]);
      if (tRes.ok) setTargets(await tRes.json());
      if (sRes.ok) setScans(await sRes.json());
    } catch {
      setError("Failed to load. Is the backend up?");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while any scan is still running.
  const anyRunning = useMemo(
    () => scans.some((s) => s.status === "running" || s.status === "queued"),
    [scans],
  );
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [anyRunning, load]);

  const launch = async () => {
    if (!selectedUrl) {
      setError("Pick a target first.");
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const res = await apiFetch("/api/security/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: selectedUrl,
          engine,
          profile,
          authHeaders: authHeader.trim() ? [authHeader.trim()] : [],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Scan launch failed.");
      } else {
        await load();
      }
    } finally {
      setLaunching(false);
    }
  };

  const openDetail = async (id: string) => {
    const res = await apiFetch(`/api/security/scans/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  // Live-stream the open scan: while it's running/queued, re-fetch the
  // detail every 2s so findings + severity counts fill in as Nuclei
  // discovers them (backend saves incrementally).
  useEffect(() => {
    if (!detail || (detail.status !== "running" && detail.status !== "queued")) return;
    const id = setInterval(async () => {
      const res = await apiFetch(`/api/security/scans/${detail._id}`);
      if (res.ok) setDetail(await res.json());
    }, 2000);
    return () => clearInterval(id);
  }, [detail]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-[#e8871e] dark:text-[#5ab4c5]" />
            Security Scans
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Passive pen-test of apps Pulse deployed. Scans only owned assets —
            no free-text URLs.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-400 bg-red-500/10 px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Launch panel */}
      <div className="mb-8 rounded-2xl border bg-card p-5">
        <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          New scan
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Target (owned assets)</span>
            <select
              value={selectedUrl}
              onChange={(e) => setSelectedUrl(e.target.value)}
              className="min-w-72 rounded-xl border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select a target…</option>
              {targets.map((t) => (
                <option key={t.url} value={t.url}>
                  {t.label} — {t.url}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Engine</span>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as "passive" | "nuclei" | "zap")}
              className="rounded-xl border bg-background px-3 py-2 text-sm"
            >
              <option value="passive">Passive (built-in · headers/TLS/cookies · non-intrusive)</option>
              <option value="nuclei">Nuclei (active vuln scan · CVEs/misconfig · if enabled)</option>
              <option value="zap">OWASP ZAP baseline (if enabled)</option>
            </select>
          </label>
          {engine === "nuclei" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Depth</span>
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as "fast" | "deep")}
                className="rounded-xl border bg-background px-3 py-2 text-sm"
              >
                <option value="fast">Fast (scoped templates · ~1 min)</option>
                <option value="deep">Deep (all templates + info · ~10-15 min)</option>
              </select>
            </label>
          )}
          <button
            onClick={launch}
            disabled={launching || !selectedUrl}
            className="flex items-center gap-2 rounded-xl bg-[#e8871e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-[#2a7f9e]"
          >
            {launching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run scan
          </button>
        </div>
        {engine === "nuclei" && (
          <div className="mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Auth header (optional — scan behind login)
              </span>
              <input
                value={authHeader}
                onChange={(e) => setAuthHeader(e.target.value)}
                placeholder="Authorization: Bearer <test-jwt>   or   Cookie: session=…"
                className="w-full rounded-xl border bg-background px-3 py-2 font-mono text-xs"
              />
            </label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sent with every request so Nuclei reaches authenticated endpoints.
              Not stored — used only for this run.
            </p>
          </div>
        )}
        {targets.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            No scannable targets yet — deploy an app or add an http endpoint first.
          </p>
        )}
      </div>

      {/* Scan history */}
      <div className="rounded-2xl border bg-card">
        <div className="border-b px-5 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Scan history ({scans.length})
        </div>
        {scans.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No scans yet.
          </div>
        ) : (
          <ul>
            {scans.map((s) => (
              <li
                key={s._id}
                onClick={() => openDetail(s._id)}
                className="flex cursor-pointer items-center justify-between border-b px-5 py-4 last:border-b-0 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {s.topSeverity && SEV_ORDER.indexOf(s.topSeverity) <= 1 ? (
                      <ShieldAlert className="h-4 w-4 text-red-500" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    )}
                    {s.targetLabel}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                      {s.engine}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.targetUrl}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Severity chips */}
                  <div className="flex gap-1">
                    {SEV_ORDER.map((sev) =>
                      s.severityCounts[sev] ? (
                        <span
                          key={sev}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SEV_STYLE[sev]}`}
                        >
                          {s.severityCounts[sev]} {sev[0].toUpperCase()}
                        </span>
                      ) : null,
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      s.status === "completed"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : s.status === "failed"
                          ? "bg-red-500/15 text-red-500"
                          : "bg-amber-500/15 text-amber-500"
                    }`}
                  >
                    {s.status === "running" || s.status === "queued" ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> {s.status}
                      </span>
                    ) : (
                      s.status
                    )}
                  </span>
                  <span className="w-16 text-right text-xs text-muted-foreground">
                    {fmtWhen(s.createdAt)}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail drawer */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setDetail(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-lg font-bold">
                  {detail.targetLabel}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                    {detail.engine}
                    {detail.engine === "nuclei" && detail.profile ? ` · ${detail.profile}` : ""}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{detail.targetUrl}</div>
                {(detail.status === "running" || detail.status === "queued") && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    scanning… {detail.findingCount} finding
                    {detail.findingCount === 1 ? "" : "s"} so far (live)
                  </div>
                )}
              </div>
              <button onClick={() => setDetail(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {SEV_ORDER.map((sev) =>
                detail.severityCounts[sev] ? (
                  <span
                    key={sev}
                    className={`rounded px-2 py-1 text-xs font-bold ${SEV_STYLE[sev]}`}
                  >
                    {detail.severityCounts[sev]} {sev}
                  </span>
                ) : null,
              )}
              {detail.findingCount === 0 && detail.status === "completed" && (
                <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs font-bold text-emerald-500">
                  ✓ Clean — no findings
                </span>
              )}
            </div>

            {detail.error && (
              <div className="mb-4 rounded-xl border border-red-400 bg-red-500/10 px-3 py-2 text-xs">
                {detail.error}
              </div>
            )}

            <div className="space-y-3">
              {(detail.findings || [])
                .slice()
                .sort(
                  (a, b) =>
                    SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity),
                )
                .map((f, i) => (
                  <div key={i} className="rounded-xl border p-4">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV_STYLE[f.severity]}`}
                      >
                        {f.severity}
                      </span>
                      <span className="font-semibold">{f.title}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{f.detail}</p>
                    {f.evidence && (
                      <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                        {f.evidence}
                      </pre>
                    )}
                    <p className="mt-2 text-xs">
                      <span className="font-semibold text-[#e8871e] dark:text-[#5ab4c5]">
                        Fix:{" "}
                      </span>
                      {f.remediation}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
