"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronRight,
  CircleDashed,
  Copy,
  Download,
  ExternalLink,
  GitCommit,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Tag as TagIcon,
  Terminal,
  Timer,
  Trash2,
  User,
  X,
} from "lucide-react";

import { API_URL } from "@/lib/api";
import type { ProgressCardData } from "@/components/deployment-progress";

// Coarse pipeline stages, ordered top-to-bottom like the Bitbucket
// pipeline sidebar. Each stage owns a set of sub-stage strings emitted
// by the Jenkinsfile / Pulse callbacks — matchStages routes raw events
// into the right sidebar row.
const STAGES: ReadonlyArray<{
  key: string;
  label: string;
  detail: string;
  matchStages: (s: string) => boolean;
  // Which Jenkins declarative-stage labels belong to this coarse phase.
  // Right panel filters logRows using this so each tab only shows its
  // own phase's rows (Bitbucket Pipelines behaviour). Undefined = show
  // everything.
  jenkinsLabels?: readonly string[];
}> = [
  {
    key: "received",
    label: "Received",
    detail: "Pulse recorded the submission.",
    matchStages: (s) => s === "pending_approval" || s === "received",
  },
  {
    key: "approved",
    label: "Approved",
    detail: "DevOps admin approved dispatch.",
    matchStages: (s) => s === "approved" || s === "dry_run",
  },
  {
    key: "webhook",
    label: "Webhook",
    detail: "Bitbucket webhook registered.",
    matchStages: (s) => s === "webhook_added" || s.startsWith("webhook"),
  },
  {
    key: "tags",
    label: "Tags pushed",
    detail: "Alpha/prod tag pushed to Bitbucket.",
    matchStages: (s) => s === "tags_pushed" || s.startsWith("tag"),
  },
  {
    key: "image_built",
    label: "Build and Push Image",
    detail: "Kaniko built + pushed container image.",
    matchStages: (s) =>
      s === "building_image" ||
      s === "image_built" ||
      s === "failed_build" ||
      s.startsWith("kaniko") ||
      s.startsWith("vuln_source") ||
      s.startsWith("test") ||
      s.startsWith("checkout"),
    jenkinsLabels: [
      "Checkout",
      "Delegate to repo Jenkinsfile",
      "Vuln Scan (Source)",
      "Test",
      "Build & Push Staging",
      "Build & Push Production",
    ],
  },
  {
    key: "manifest_pushed",
    label: "Manifests",
    detail: "generate-manifests.sh emitted + pushed.",
    matchStages: (s) =>
      s === "pushing_manifest" ||
      s === "manifest_pushed" ||
      s === "failed_manifest" ||
      s.startsWith("manifest") ||
      s.startsWith("vuln_image"),
    jenkinsLabels: ["Vuln Scan (Image)", "Create Manifests"],
  },
  {
    key: "completed",
    label: "Completed",
    detail: "ArgoCD picks up the change.",
    matchStages: (s) =>
      s === "completed" ||
      s === "cleaning_up" ||
      s === "failed" ||
      s.startsWith("cleanup"),
    jenkinsLabels: ["Cleanup"],
  },
] as const;

type StageState = "done" | "current" | "pending" | "failed";

function progressCardToStageIndex(status: string): {
  reached: number;
  failed: boolean;
  failedAt: number;
} {
  switch (status) {
    case "rejected":
      return { reached: 0, failed: true, failedAt: 1 };
    case "failed_build":
      return { reached: 3, failed: true, failedAt: 4 };
    case "failed_manifest":
      return { reached: 4, failed: true, failedAt: 5 };
    case "failed":
      return { reached: 5, failed: true, failedAt: 6 };
    case "completed":
      return { reached: 6, failed: false, failedAt: 0 };
    case "cleaning_up":
      return { reached: 5, failed: false, failedAt: 0 };
    case "pushing_manifest":
      return { reached: 4, failed: false, failedAt: 0 };
    case "building_image":
      return { reached: 3, failed: false, failedAt: 0 };
    case "manifest_pushed":
      return { reached: 5, failed: false, failedAt: 0 };
    case "image_built":
      return { reached: 4, failed: false, failedAt: 0 };
    case "tags_pushed":
      return { reached: 3, failed: false, failedAt: 0 };
    case "webhook_added":
      return { reached: 2, failed: false, failedAt: 0 };
    case "approved":
    case "dry_run":
      return { reached: 1, failed: false, failedAt: 0 };
    default:
      return { reached: 0, failed: false, failedAt: 0 };
  }
}

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

interface ConsoleResponse {
  text: string;
  offset: number;
  more: boolean;
  buildNumber: number | null;
  tag: string | null;
}

const POLL_EVENTS_MS = 5000;
const POLL_CONSOLE_MS = 3000;
const MAX_CHARS = 120_000;

// Strip ANSI, split Jenkins log into one row per `+ shell command`.
// Each row carries its parent declarative-stage name so the right panel
// can filter by the coarse phase the user picked in the sidebar. The
// latest row is auto-expanded (the command currently running); earlier
// rows collapse.
interface LogRow {
  stage: string;
  label: string;
  body: string;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Jenkins progressiveText prefixes every `[Pipeline]` marker with a
// base64-ish hyperlink blob (`IAAAA=` etc.) and follows it with a
// `ha:////...=` continuation line. Match unanchored + drop the noise.
// `.+?` (lazy) + trailing `\)` at line-end handles nested parens like
// `Vuln Scan (Source)`. `\r?` because Jenkins uses CRLF endings.
const STAGE_MARKER_RE = /\[Pipeline\] \{ \((.+?)\)\r?$/;
const STAGE_STAGE_RE = /\[Pipeline\] stage\b/;
const HA_BLOB_RE = /^ha:\/\/\/\/[A-Za-z0-9+/=]+/;

function splitLogIntoRows(text: string): LogRow[] {
  if (!text) return [];
  const clean = text.replace(ANSI_RE, "");
  const lines = clean.split("\n");
  const rows: LogRow[] = [];
  let curStage = "Console";
  let cur: LogRow | null = null;

  const flush = () => {
    if (cur) {
      cur.body = cur.body.replace(/\s+$/, "");
      rows.push(cur);
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r/g, "");
    // Stage marker → update the parent stage context. No new row here;
    // the next `+ cmd` inside this stage opens the first row.
    const stageMatch = line.match(STAGE_MARKER_RE);
    if (stageMatch) {
      flush();
      curStage = stageMatch[1];
      continue;
    }
    if (HA_BLOB_RE.test(line)) continue;
    if (STAGE_STAGE_RE.test(line)) continue;
    if (/\[Pipeline\] (\}|\/\/|End of Pipeline|node|Start of Pipeline)/.test(line)) {
      continue;
    }
    // Shell `+ cmd` → new row inside the current stage. Keep the raw
    // command as the row label so scanning down the list reads like a
    // shell transcript.
    const cmdMatch = line.match(/^\+ (.+)/);
    if (cmdMatch) {
      flush();
      cur = { stage: curStage, label: cmdMatch[1], body: line + "\n" };
      continue;
    }
    if (!cur) cur = { stage: curStage, label: curStage, body: "" };
    cur.body += line + "\n";
  }
  flush();
  return rows;
}

function formatDuration(sec: number): string {
  if (sec < 1) return "<1s";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, (now - then) / 1000);
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

interface Props {
  data: ProgressCardData & { trackToken?: string };
  token: string;
  live: boolean;
  onRerun?: () => void;
}

export function DeploymentBitbucketTracker({
  data,
  token,
  live,
  onRerun,
}: Props) {
  const [events, setEvents] = useState<FlatEvent[]>([]);
  const [consoleText, setConsoleText] = useState<string>("");
  const [consoleMeta, setConsoleMeta] = useState<{
    buildNumber: number | null;
    tag: string | null;
  }>({ buildNumber: null, tag: null });
  const consoleOffsetRef = useRef<number>(0);
  const [activeStageKey, setActiveStageKey] = useState<string>("image_built");
  // Manual expand/collapse override per row (keyed by row label).
  // Absent → follow auto rule: latest row auto-expanded while live,
  // completed rows auto-collapsed.
  const [manualToggles, setManualToggles] = useState<Record<string, boolean>>(
    {},
  );
  const consoleContainerRef = useRef<HTMLDivElement>(null);

  const { reached, failed, failedAt } = progressCardToStageIndex(data.status);

  // Auto-jump the active tab to whatever stage is currently in flight or
  // failed. User can still click any stage to override.
  const autoActiveRef = useRef<boolean>(true);
  useEffect(() => {
    if (!autoActiveRef.current) return;
    if (failed) {
      const key = STAGES[failedAt]?.key;
      if (key) setActiveStageKey(key);
    } else {
      const idx = Math.min(reached + 1, STAGES.length - 1);
      const key = STAGES[idx]?.key;
      if (key) setActiveStageKey(key);
    }
  }, [reached, failed, failedAt]);

  // Poll events feed for stage rows in each sidebar entry.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `${API_URL}/api/deployments/track/${token}/events`,
        );
        if (!res.ok) return;
        const raw = (await res.json()) as EventsResponse;
        if (cancelled) return;
        const flat: FlatEvent[] = [];
        for (const [tt, byAttempt] of Object.entries(raw.timelines ?? {})) {
          for (const [attemptStr, rows] of Object.entries(byAttempt)) {
            const attempt = Number(attemptStr);
            for (const r of rows) flat.push({ ...r, attempt, trackToken: tt });
          }
        }
        flat.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        setEvents(flat);
      } catch {
        /* ignore */
      }
    }
    const loop = async () => {
      await fetchOnce();
      if (cancelled) return;
      if (live) timer = setTimeout(loop, POLL_EVENTS_MS);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, live]);

  // Poll Jenkins console progressively. Only feeds the right panel when
  // a Jenkins-owned stage tab is active — but poll always so the log is
  // ready as soon as the user clicks Build.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `${API_URL}/api/deployments/track/${token}/console?start=${consoleOffsetRef.current}`,
        );
        if (!res.ok) return;
        const raw = (await res.json()) as ConsoleResponse;
        if (cancelled) return;
        if (raw.buildNumber == null) return;
        setConsoleMeta({ buildNumber: raw.buildNumber, tag: raw.tag });
        if (raw.text) {
          setConsoleText((prev) => {
            const next = prev + raw.text;
            return next.length > MAX_CHARS
              ? next.slice(next.length - MAX_CHARS)
              : next;
          });
          consoleOffsetRef.current = raw.offset;
        }
      } catch {
        /* ignore */
      }
    }
    const loop = async () => {
      await fetchOnce();
      if (cancelled) return;
      if (live) timer = setTimeout(loop, POLL_CONSOLE_MS);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, live]);

  const perStageEvents = useMemo(() => {
    const bucket: Record<string, FlatEvent[]> = {};
    for (const s of STAGES) bucket[s.key] = [];
    for (const ev of events) {
      const s = STAGES.find((stg) => stg.matchStages(ev.stage));
      if (s) bucket[s.key].push(ev);
    }
    return bucket;
  }, [events]);

  // Per-stage duration = last event.ts - first event.ts within the
  // bucket. Approximation but matches how Bitbucket rolls it up.
  const stageDurations = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STAGES) {
      const evs = perStageEvents[s.key] ?? [];
      if (evs.length === 0) {
        out[s.key] = 0;
        continue;
      }
      const first = new Date(evs[0].ts).getTime();
      const last = new Date(evs[evs.length - 1].ts).getTime();
      out[s.key] = Math.max(0, (last - first) / 1000);
    }
    return out;
  }, [perStageEvents]);

  const totalDurationSec = useMemo(() => {
    if (events.length === 0) return 0;
    const first = new Date(events[0].ts).getTime();
    const last = new Date(events[events.length - 1].ts).getTime();
    return Math.max(0, (last - first) / 1000);
  }, [events]);

  const activeStageIdx = STAGES.findIndex((s) => s.key === activeStageKey);
  const activeStage = STAGES[activeStageIdx];
  const activeEvents = perStageEvents[activeStageKey] ?? [];
  const showLive =
    activeStageKey === "image_built" ||
    activeStageKey === "manifest_pushed" ||
    activeStageKey === "completed";
  const logRows = useMemo(() => {
    if (!showLive) return [];
    const all = splitLogIntoRows(consoleText);
    const wanted = activeStage?.jenkinsLabels;
    if (!wanted || wanted.length === 0) return all;
    // Match on the parent Jenkins stage — each row is one `+ cmd`
    // scoped to its declarative stage. Substring match to tolerate
    // slight name drift (e.g. `Build & Push Staging` vs `Build & Push`).
    return all.filter((r) =>
      wanted.some((w) => r.stage === w || r.stage.startsWith(w)),
    );
  }, [showLive, consoleText, activeStage]);

  // Reset manual overrides whenever the active stage changes so auto
  // rule kicks back in on the freshly-opened tab.
  useEffect(() => {
    setManualToggles({});
  }, [activeStageKey]);

  // Autoscroll to bottom on new content.
  useEffect(() => {
    const el = consoleContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [consoleText, logRows.length]);

  // Auto-expand rule (may be overridden per-row via manualToggles):
  // last row → expanded while `live` is still true; else collapsed.
  const isLogRowExpanded = (label: string, i: number, total: number) => {
    const manual = manualToggles[`log:${label}:${i}`];
    if (manual !== undefined) return manual;
    return live && i === total - 1;
  };
  const isEventRowExpanded = (label: string, i: number, total: number) => {
    const manual = manualToggles[`ev:${label}:${i}`];
    if (manual !== undefined) return manual;
    return live && i === total - 1;
  };

  // Header status color mirrors Bitbucket: green success, blue running,
  // red failed.
  const headerVariant: "success" | "running" | "failed" | "pending" = failed
    ? "failed"
    : data.status === "completed"
      ? "success"
      : data.status === "pending_approval"
        ? "pending"
        : "running";

  const jenkinsBuildUrl =
    data.latestJenkinsBuildUrl ??
    events.find((e) => e.jenkinsBuildUrl)?.jenkinsBuildUrl ??
    null;
  const jenkinsConsoleHref =
    consoleMeta.buildNumber && consoleMeta.tag
      ? `https://jenkins.media-meter.in/job/bitbucket/job/${data.repoSlug}/job/${consoleMeta.tag}/${consoleMeta.buildNumber}/console`
      : data.latestJenkinsConsoleUrl ?? null;

  return (
    <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-2xl border bg-card shadow-sm md:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
      {/* ------------------------------------------------------------------ */}
      {/* LEFT SIDEBAR                                                       */}
      {/* ------------------------------------------------------------------ */}
      <aside className="flex flex-col gap-3 border-b bg-muted/30 p-4 md:border-b-0 md:border-r">
        {/* Status header card. Green when done, blue when running, red
            on failure. Matches Bitbucket's #138 card. */}
        <div
          className={`rounded-lg px-3 py-2.5 ${
            headerVariant === "success"
              ? "bg-green-600 text-white"
              : headerVariant === "failed"
                ? "bg-red-600 text-white"
                : headerVariant === "pending"
                  ? "bg-yellow-500 text-white"
                  : "bg-blue-600 text-white"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {headerVariant === "success" ? (
                <Check className="h-4 w-4" />
              ) : headerVariant === "failed" ? (
                <X className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              <span className="font-mono text-sm font-semibold">
                #{data.repoSlug}
              </span>
            </div>
            {onRerun && (
              <button
                type="button"
                onClick={onRerun}
                className="rounded-md bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30"
              >
                Rerun
              </button>
            )}
          </div>
        </div>

        {/* Commit / tag / timing card. */}
        <div className="space-y-1.5 rounded-lg border bg-background/60 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <GitCommit className="h-3 w-3" />
            <span className="font-mono">{data.workloadKind}</span>
            {data.role && (
              <span className="font-mono text-muted-foreground">
                / {data.role}
              </span>
            )}
          </div>
          {consoleMeta.tag && (
            <div className="flex items-center gap-1.5">
              <TagIcon className="h-3 w-3 text-[#e8871e] dark:text-[#5ab4c5]" />
              <span className="font-mono text-[11px] text-[#e8871e] dark:text-[#5ab4c5]">
                {consoleMeta.tag}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Timer className="h-3 w-3" />
            <span className="tabular-nums">
              {totalDurationSec > 0 ? formatDuration(totalDurationSec) : "—"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate">
              {data.requestedBy ?? "unknown"}
            </span>
          </div>
          {data.createdAt && (
            <div className="text-muted-foreground">
              {timeAgo(data.createdAt)}
            </div>
          )}
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {data.cluster}
            </span>
            <span className="rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {data.environments.join(" + ")}
            </span>
            {typeof data.attempt === "number" && data.attempt > 1 && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                attempt {data.attempt}
              </span>
            )}
          </div>
        </div>

        {/* Pipeline list. Clickable rows drive activeStageKey. */}
        <div className="flex flex-col rounded-lg border bg-background/60">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold">Pipeline</span>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              <Settings className="h-3.5 w-3.5" />
            </div>
          </div>
          <ol className="flex flex-col">
            {STAGES.map((stage, i) => {
              const isFail = failed && i === failedAt;
              const isCurrent =
                !failed && i === reached + 1 && i < STAGES.length;
              const isDone = i <= reached && !isFail;
              const stageState: StageState = isFail
                ? "failed"
                : isCurrent
                  ? "current"
                  : isDone
                    ? "done"
                    : "pending";
              const active = stage.key === activeStageKey;
              const dur = stageDurations[stage.key] ?? 0;

              return (
                <li key={stage.key}>
                  <button
                    type="button"
                    onClick={() => {
                      autoActiveRef.current = false;
                      setActiveStageKey(stage.key);
                      setManualToggles({});
                    }}
                    className={`flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-l-[#e8871e] bg-[#e8871e]/10 dark:border-l-[#2a7f9e] dark:bg-[#2a7f9e]/10"
                        : "border-l-transparent hover:bg-muted/50"
                    }`}
                  >
                    <StageIcon state={stageState} />
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span
                        className={`truncate text-xs ${
                          active
                            ? "font-semibold text-foreground"
                            : stageState === "pending"
                              ? "text-muted-foreground"
                              : "text-foreground"
                        }`}
                      >
                        {stage.label}
                      </span>
                      {dur > 0 && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatDuration(dur)}
                        </span>
                      )}
                    </div>
                    {stageState === "done" && stage.key === "completed" && (
                      <span className="rounded-md bg-[#e8871e]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#e8871e] dark:bg-[#2a7f9e]/15 dark:text-[#5ab4c5]">
                        Redeploy
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {data.manifestPath && (
          <div className="rounded-md border bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
            → {data.manifestPath}
          </div>
        )}

        {/* ArgoCD links per env — one row per env once the record has
            an ArgoCD app registered. Shows regardless of status so
            devs can jump to the Application even while a build is in
            flight (useful for seeing sync + resource state). */}
        {data.argocdLinks && Object.keys(data.argocdLinks).length > 0 && (
          <div className="flex flex-col gap-1 rounded-md border bg-background/60 p-2 text-[11px]">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              ArgoCD
            </span>
            {Object.entries(data.argocdLinks).map(([env, url]) => (
              <a
                key={env}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 truncate text-[#e8871e] hover:underline dark:text-[#5ab4c5]"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="font-mono">{env}</span>
              </a>
            ))}
          </div>
        )}
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* RIGHT MAIN PANEL                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="flex min-h-[600px] flex-col">
        {/* Tabs strip. One tab per environment; icons on the right
            mirror the Bitbucket action rail. */}
        <div className="flex items-center justify-between border-b px-3">
          <div className="flex items-center gap-0">
            {data.environments.map((env) => {
              const envStatus =
                data.envStatuses?.[env] ?? (data.environments.length === 1 ? data.status : "");
              return (
                <button
                  key={env}
                  type="button"
                  className="relative -mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground data-[active=true]:border-[#e8871e] data-[active=true]:text-foreground dark:data-[active=true]:border-[#2a7f9e]"
                  data-active="true"
                >
                  {env}
                  {envStatus && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {envStatus}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <Search className="h-4 w-4 cursor-pointer hover:text-foreground" />
            {jenkinsConsoleHref && (
              <a
                href={jenkinsConsoleHref}
                target="_blank"
                rel="noreferrer"
                title="Download full log"
              >
                <Download className="h-4 w-4 cursor-pointer hover:text-foreground" />
              </a>
            )}
            <Trash2 className="h-4 w-4 cursor-pointer hover:text-foreground" />
            {jenkinsBuildUrl && (
              <a
                href={jenkinsBuildUrl}
                target="_blank"
                rel="noreferrer"
                title="Jenkins build"
              >
                <Info className="h-4 w-4 cursor-pointer hover:text-foreground" />
              </a>
            )}
          </div>
        </div>

        {/* Command / log row list. Each row: title on the left, duration
            + chevron on the right. Clicking expands the body. */}
        <div
          ref={consoleContainerRef}
          className="flex-1 overflow-auto"
        >
          {/* Fixed header row like "Build setup". */}
          <LogHeaderRow label={`${activeStage?.label ?? "Console"} setup`} />

          {showLive ? (
            <>
              {logRows.length === 0 ? (
                <div className="px-4 py-6 text-xs text-muted-foreground">
                  {live
                    ? "Waiting for Jenkins to pick up the tag build…"
                    : "No console output for this stage."}
                </div>
              ) : (
                logRows.map((row, i) => {
                  const expanded = isLogRowExpanded(row.label, i, logRows.length);
                  const isLatest = i === logRows.length - 1;
                  return (
                    <LogCommandRow
                      key={`${row.label}-${i}`}
                      row={row}
                      expanded={expanded}
                      isLatest={isLatest}
                      live={live}
                      onToggle={() =>
                        setManualToggles((m) => ({
                          ...m,
                          [`log:${row.label}:${i}`]: !expanded,
                        }))
                      }
                    />
                  );
                })
              )}
            </>
          ) : activeEvents.length === 0 ? (
            <div className="px-4 py-6 text-xs text-muted-foreground">
              No events recorded for this stage yet.
            </div>
          ) : (
            activeEvents.map((ev, i) => {
              const label = ev.stage;
              const expanded = isEventRowExpanded(
                label,
                i,
                activeEvents.length,
              );
              const isLatest = i === activeEvents.length - 1;
              return (
                <EventLogRow
                  key={`${label}-${i}`}
                  event={ev}
                  expanded={expanded}
                  isLatest={isLatest}
                  live={live}
                  onToggle={() =>
                    setManualToggles((m) => ({
                      ...m,
                      [`ev:${label}:${i}`]: !expanded,
                    }))
                  }
                />
              );
            })
          )}

          <LogHeaderRow label={`${activeStage?.label ?? "Console"} teardown`} />
        </div>
      </section>
    </div>
  );
}

function StageIcon({ state }: { state: StageState }) {
  if (state === "failed") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <X className="h-3 w-3" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-blue-500 bg-background text-blue-500">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      </span>
    );
  }
  if (state === "done") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
      <CircleDashed className="h-3 w-3" />
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked in insecure origins — ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm hover:bg-background hover:text-foreground"
      title="Copy to clipboard"
    >
      {copied ? (
        <>
          <Check className="h-2.5 w-2.5 text-green-500" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-2.5 w-2.5" />
          Copy
        </>
      )}
    </button>
  );
}

function LogHeaderRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
      <span className="font-mono">{label}</span>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">&lt;1s</span>
        <ChevronRight className="h-3 w-3" />
      </div>
    </div>
  );
}

function LogCommandRow({
  row,
  expanded,
  isLatest,
  live,
  onToggle,
}: {
  row: LogRow;
  expanded: boolean;
  isLatest: boolean;
  live: boolean;
  onToggle: () => void;
}) {
  const running = live && isLatest;
  return (
    <div className="border-b">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
          ) : (
            <Check className="h-3 w-3 shrink-0 text-green-600" />
          )}
          {row.stage && row.stage !== "Console" && (
            <span className="shrink-0 rounded-md border px-1 py-0 text-[9px] font-medium text-muted-foreground">
              {row.stage}
            </span>
          )}
          <span className="truncate font-mono text-xs text-foreground">
            {row.label}
          </span>
          {running && (
            <span className="rounded-md bg-blue-100 px-1 py-0 text-[9px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              running
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="tabular-nums text-[10px]">
            {row.body ? `${Math.max(1, row.body.split("\n").length - 1)} lines` : "<1s"}
          </span>
          <ChevronRight
            className={`h-3 w-3 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </button>
      {expanded && row.body && (
        <div className="relative">
          <CopyButton text={row.body} />
          <pre className="max-h-96 overflow-auto bg-black/90 px-4 py-2 pr-16 font-mono text-[11px] leading-snug text-green-100 dark:bg-black">
            {row.body}
          </pre>
        </div>
      )}
    </div>
  );
}

function EventLogRow({
  event,
  expanded,
  isLatest,
  live,
  onToggle,
}: {
  event: FlatEvent;
  expanded: boolean;
  isLatest: boolean;
  live: boolean;
  onToggle: () => void;
}) {
  const failure = event.state === "failed";
  const running =
    live && isLatest && event.state !== "success" && event.state !== "completed";
  return (
    <div className="border-b">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          {running ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />
          ) : (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                failure
                  ? "bg-red-500"
                  : event.state === "success" || event.state === "completed"
                    ? "bg-green-500"
                    : "bg-blue-400"
              }`}
            />
          )}
          <span className="truncate font-mono text-xs">{event.stage}</span>
          <span className="rounded-md bg-muted px-1 py-0 text-[9px] font-medium uppercase text-muted-foreground">
            {event.state}
          </span>
          {event.buildId && (
            <span className="font-mono text-[10px] text-muted-foreground">
              #{event.buildId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="tabular-nums text-[10px]">
            {new Date(event.ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <ChevronRight
            className={`h-3 w-3 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
        </div>
      </button>
      {expanded && (event.logExcerpt || event.error) && (
        <div className="relative">
          <CopyButton text={(event.logExcerpt ?? event.error) ?? ""} />
          <pre className="max-h-96 overflow-auto bg-red-50/70 px-4 py-2 pr-16 font-mono text-[11px] leading-snug text-red-900 dark:bg-red-950/30 dark:text-red-100">
            {event.logExcerpt || event.error}
          </pre>
        </div>
      )}
      {expanded && (event.jenkinsBuildUrl || event.jenkinsConsoleUrl) && (
        <div className="flex flex-wrap gap-3 border-t bg-muted/20 px-4 py-1.5 text-[10px]">
          {event.jenkinsBuildUrl && (
            <a
              href={event.jenkinsBuildUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Build
            </a>
          )}
          {event.jenkinsConsoleUrl && (
            <a
              href={event.jenkinsConsoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
            >
              <Terminal className="h-2.5 w-2.5" />
              Console
            </a>
          )}
        </div>
      )}
    </div>
  );
}
