"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  KeyRound,
  RefreshCw,
  Search,
  User as UserIcon,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/api";

interface SecretEvent {
  id: string;
  projectSlug: string;
  envSlug: string;
  secretKey: string;
  version: number;
  changedAt: string;
  actorType: string;
  actor: string;
  alertSent: boolean;
}

interface Response {
  count: number;
  total: number;
  events: SecretEvent[];
}

interface Facets {
  projects: string[];
  envs: string[];
  actors: string[];
}

// Absolute time in Asia/Manila (PHT / UTC+8) — the org runs on PHT and
// the ops team wants secret-change timestamps to match wall-clock time
// they'd see on their machines, not the browser's guessed locale.
const TZ = "Asia/Manila";
const _fmtDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function fmtAbs(iso: string): string {
  return _fmtDate.format(new Date(iso)) + " PHT";
}

function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, (Date.now() - then) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function InfisicalHistoryPage() {
  const [data, setData] = useState<Response | null>(null);
  const [facets, setFacets] = useState<Facets>({
    projects: [],
    envs: [],
    actors: [],
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [project, setProject] = useState("");
  const [env, setEnv] = useState("");
  const [actor, setActor] = useState("");
  const [keyQuery, setKeyQuery] = useState("");

  const [drill, setDrill] = useState<SecretEvent | null>(null);
  const [drillVersions, setDrillVersions] = useState<SecretEvent[]>([]);

  const load = async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (project) q.set("project", project);
    if (env) q.set("env", env);
    if (actor) q.set("actor", actor);
    if (keyQuery) q.set("key", keyQuery);
    q.set("limit", "300");
    const res = await apiFetch(`/api/infisical/secret-history?${q}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  };

  const loadFacets = async () => {
    const res = await apiFetch(`/api/infisical/facets`);
    if (res.ok) setFacets(await res.json());
  };

  useEffect(() => {
    loadFacets();
  }, []);

  useEffect(() => {
    load();
  }, [project, env, actor, keyQuery]);

  const runSync = async () => {
    setSyncing(true);
    try {
      await apiFetch(`/api/infisical/sync`, { method: "POST" });
      await load();
      await loadFacets();
    } finally {
      setSyncing(false);
    }
  };

  const openDrill = async (ev: SecretEvent) => {
    setDrill(ev);
    setDrillVersions([]);
    const q = new URLSearchParams({
      project: ev.projectSlug,
      env: ev.envSlug,
      key: ev.secretKey,
    });
    const res = await apiFetch(`/api/infisical/secret-history/versions?${q}`);
    if (res.ok) {
      const body = await res.json();
      setDrillVersions(body.versions ?? []);
    }
  };

  const clearFilters = () => {
    setProject("");
    setEnv("");
    setActor("");
    setKeyQuery("");
  };

  const anyFilter = project || env || actor || keyQuery;

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#e8871e] dark:text-[#5ab4c5]" />
            <h1 className="text-xl font-semibold">Infisical secret history</h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Who changed which secret, when. Values never shown.
          </p>
        </div>
        <button
          type="button"
          onClick={runSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          Sync now
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-sm">
        <FacetSelect
          value={project}
          onChange={setProject}
          options={facets.projects}
          placeholder="All projects"
        />
        <FacetSelect
          value={env}
          onChange={setEnv}
          options={facets.envs}
          placeholder="All envs"
        />
        <FacetSelect
          value={actor}
          onChange={setActor}
          options={facets.actors}
          placeholder="All actors"
        />
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={keyQuery}
            onChange={(e) => setKeyQuery(e.target.value)}
            placeholder="filter by key (exact)"
            className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#e8871e]"
          />
        </div>
        {anyFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {data ? `${data.count} of ${data.total}` : "…"}
        </span>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center rounded-2xl border bg-card p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : data && data.events.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No secret changes recorded for these filters.
        </div>
      ) : data && (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Project</th>
                <th className="px-4 py-2 text-left font-medium">Env</th>
                <th className="px-4 py-2 text-left font-medium">Secret</th>
                <th className="px-4 py-2 text-left font-medium">v</th>
                <th className="px-4 py-2 text-left font-medium">Actor</th>
                <th className="px-4 py-2 text-left font-medium">Changed</th>
                <th className="px-4 py-2 text-left font-medium">Alert</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.events.map((ev) => {
                const isProd =
                  ev.envSlug === "prod" || ev.envSlug === "production";
                return (
                  <tr
                    key={ev.id}
                    onClick={() => openDrill(ev)}
                    className="cursor-pointer hover:bg-muted/30"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {ev.projectSlug}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                          isProd
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {ev.envSlug}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {ev.secretKey}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {ev.version}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <UserIcon
                          className={`h-3 w-3 ${
                            ev.actorType === "identity"
                              ? "text-[#e8871e] dark:text-[#5ab4c5]"
                              : "text-muted-foreground"
                          }`}
                        />
                        <span className="text-xs">{ev.actor}</span>
                        <span className="rounded-md border px-1 py-0 text-[9px] text-muted-foreground">
                          {ev.actorType}
                        </span>
                      </div>
                    </td>
                    <td
                      className="px-4 py-2 text-xs text-muted-foreground"
                      title={fmtAbs(ev.changedAt)}
                    >
                      <div className="flex flex-col">
                        <span>{fmtWhen(ev.changedAt)}</span>
                        <span className="text-[10px] opacity-70">
                          {fmtAbs(ev.changedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {ev.alertSent && (
                        <span className="rounded-md bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                          fired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ChevronRight className="inline h-3.5 w-3.5 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDrill(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b px-5 py-3">
              <div>
                <div className="font-mono text-sm font-semibold">
                  {drill.projectSlug} / {drill.envSlug} / {drill.secretKey}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  All recorded versions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrill(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[60vh] overflow-auto">
              {drillVersions.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Loading…
                </div>
              ) : (
                <ul className="divide-y">
                  {drillVersions.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center gap-3 px-5 py-2 text-sm"
                    >
                      <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                        v{v.version}
                      </span>
                      <UserIcon
                        className={`h-3 w-3 shrink-0 ${
                          v.actorType === "identity"
                            ? "text-[#e8871e] dark:text-[#5ab4c5]"
                            : "text-muted-foreground"
                        }`}
                      />
                      <span className="truncate text-xs">{v.actor}</span>
                      <span
                        className="ml-auto text-[11px] text-muted-foreground"
                        title={fmtAbs(v.changedAt)}
                      >
                        {fmtWhen(v.changedAt)} · {fmtAbs(v.changedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FacetSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#e8871e]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
