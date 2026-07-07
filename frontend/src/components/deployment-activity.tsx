"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Terminal,
  ExternalLink,
} from "lucide-react";

import { API_URL } from "@/lib/api";

const POLL_MS = 5000;

interface EventRow {
  stage: string;
  state: string;
  buildId: string | null;
  jobId: string | null;
  ts: string;
  error: string | null;
  logExcerpt: string | null;
  jenkinsBuildUrl: string | null;
  jenkinsConsoleUrl: string | null;
}

interface FlatEvent extends EventRow {
  attempt: number;
  trackToken: string;
}

interface EventsResponse {
  primaryToken: string;
  submissionId: string | null;
  timelines: Record<string, Record<string, EventRow[]>>;
}

function stateIcon(state: string) {
  if (state === "failed") {
    return (
      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
    );
  }
  if (state === "success" || state === "completed") {
    return (
      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#e8871e] dark:text-[#5ab4c5]" />
    );
  }
  return (
    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  );
}

function stateBadge(state: string) {
  const styles: Record<string, string> = {
    started:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    success:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };
  return styles[state] ?? "bg-muted text-muted-foreground";
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const delta = Math.max(0, now - then);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  token: string;
  live: boolean;
}

export function DeploymentActivity({ token, live }: Props) {
  const [events, setEvents] = useState<FlatEvent[]>([]);
  const [error, setError] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
  const [openLog, setOpenLog] = useState<string | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const [newBadgeCount, setNewBadgeCount] = useState<number>(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `${API_URL}/api/deployments/track/${token}/events`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        const raw = (await res.json()) as EventsResponse;
        if (cancelled) return;
        const flat: FlatEvent[] = [];
        for (const [trackToken, byAttempt] of Object.entries(
          raw.timelines ?? {},
        )) {
          for (const [attemptStr, rows] of Object.entries(byAttempt)) {
            const attempt = Number(attemptStr);
            for (const r of rows) {
              flat.push({ ...r, attempt, trackToken });
            }
          }
        }
        // Newest first — the header is the most-fresh event.
        flat.sort(
          (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
        );

        // Count events we haven't seen yet so the "N new" pill can nudge
        // the user to scroll up. Tab-inactive case: user comes back, sees
        // the pill, clicks it to jump to top.
        const fresh = flat.filter(
          (e) => !seenIds.current.has(eventKey(e)),
        );
        if (fresh.length > 0 && seenIds.current.size > 0) {
          setNewBadgeCount((c) => c + fresh.length);
        }
        for (const e of flat) seenIds.current.add(eventKey(e));

        setEvents(flat);
        setError("");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      }
    }

    const loop = async () => {
      await fetchOnce();
      if (cancelled) return;
      if (live) {
        timer = setTimeout(loop, POLL_MS);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, live]);

  // Tick "now" every 5s so the relative timestamps stay fresh without
  // triggering a full events refetch on every second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    // Group by attempt for a visual separator inside the feed. Attempts
    // are already ordered by first event's timestamp because the flat
    // list is sorted desc, so we just walk it once.
    const out: Array<{ attempt: number; rows: FlatEvent[] }> = [];
    for (const ev of events) {
      const last = out[out.length - 1];
      if (last && last.attempt === ev.attempt) {
        last.rows.push(ev);
      } else {
        out.push({ attempt: ev.attempt, rows: [ev] });
      }
    }
    return out;
  }, [events]);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Activity</h3>
          {live && (
            <span className="rounded-md bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              live
            </span>
          )}
        </div>
        {newBadgeCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setNewBadgeCount(0);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="rounded-md bg-[#e8871e]/10 px-2 py-0.5 text-[10px] font-medium text-[#e8871e] hover:bg-[#e8871e]/20 dark:bg-[#2a7f9e]/20 dark:text-[#5ab4c5]"
          >
            {newBadgeCount} new
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-lg bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {!error && events.length === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          No events yet. Jenkins will start reporting as the build progresses.
        </div>
      )}

      <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
        {grouped.map((group, gi) => (
          <div key={`grp-${gi}`}>
            {gi > 0 || group.attempt > 1 ? (
              <div className="my-2 flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  attempt {group.attempt}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <ul className="space-y-2">
              {group.rows.map((e) => {
                const key = eventKey(e);
                const isOpen = openLog === key;
                return (
                  <li
                    key={key}
                    className="group flex items-start gap-2 rounded-lg border p-2 transition-colors hover:bg-muted/40"
                  >
                    <div className="mt-0.5">{stateIcon(e.state)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {e.stage}
                        </span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${stateBadge(e.state)}`}
                        >
                          {e.state}
                        </span>
                        {e.buildId && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            build #{e.buildId}
                          </span>
                        )}
                        <span
                          className="ml-auto text-[10px] tabular-nums text-muted-foreground"
                          title={new Date(e.ts).toLocaleString()}
                        >
                          {shortTime(e.ts)} · {relTime(e.ts, now)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        {e.jenkinsBuildUrl && (
                          <a
                            href={e.jenkinsBuildUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Build
                          </a>
                        )}
                        {e.jenkinsConsoleUrl && (
                          <a
                            href={e.jenkinsConsoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
                          >
                            <Terminal className="h-3 w-3" />
                            Console
                          </a>
                        )}
                        {(e.logExcerpt || e.error) && (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenLog((cur) => (cur === key ? null : key))
                            }
                            className="text-[10px] font-medium text-red-600 hover:underline dark:text-red-400"
                          >
                            {isOpen ? "Hide log" : "Show log"}
                          </button>
                        )}
                      </div>
                      {isOpen && (
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-red-50 p-2 font-mono text-[10px] leading-tight text-red-900 dark:bg-red-950/40 dark:text-red-100">
                          {e.logExcerpt || e.error}
                        </pre>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function eventKey(e: FlatEvent | EventRow & { attempt: number; trackToken: string }): string {
  return `${e.trackToken}:${e.attempt}:${e.buildId ?? "-"}:${e.stage}:${e.state}`;
}
