"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Loader2,
  Terminal,
  X,
} from "lucide-react";

import { API_URL } from "@/lib/api";
import type { ProgressCardData } from "@/components/deployment-progress";
import { DeploymentConsoleTail } from "@/components/deployment-console-tail";

// One row per coarse stage. Sub-events land inside the matching row via
// `matchStages` (prefix / substring rules). Kept in Pulse-then-Jenkins
// order so the vertical list reads top-to-bottom exactly like the build.
const STAGES: ReadonlyArray<{
  key: string;
  label: string;
  detail: string;
  matchStages: (s: string) => boolean;
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
    detail: "DevOps admin approved the dispatch.",
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
    detail: "Alpha/production tag pushed to Bitbucket.",
    matchStages: (s) => s === "tags_pushed" || s.startsWith("tag"),
  },
  {
    key: "image_built",
    label: "Image built",
    detail: "Kaniko built + pushed the container image.",
    matchStages: (s) =>
      s === "building_image" ||
      s === "image_built" ||
      s === "failed_build" ||
      s.startsWith("kaniko") ||
      s.startsWith("vuln_source") ||
      s.startsWith("test") ||
      s.startsWith("checkout"),
  },
  {
    key: "manifest_pushed",
    label: "Manifests",
    detail: "generate-manifests.sh emitted + pushed to manifests repo.",
    matchStages: (s) =>
      s === "pushing_manifest" ||
      s === "manifest_pushed" ||
      s === "failed_manifest" ||
      s.startsWith("manifest") ||
      s.startsWith("vuln_image"),
  },
  {
    key: "completed",
    label: "Completed",
    detail: "Build finished + ArgoCD picks up the change.",
    matchStages: (s) =>
      s === "completed" ||
      s === "cleaning_up" ||
      s === "failed" ||
      s.startsWith("cleanup"),
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

const POLL_MS = 5000;

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stateBadgeClass(state: string): string {
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

interface Props {
  data: ProgressCardData & { trackToken?: string };
  token: string;
  live: boolean;
}

export function DeploymentVerticalTracker({ data, token, live }: Props) {
  const [events, setEvents] = useState<FlatEvent[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
      if (live) timer = setTimeout(loop, POLL_MS);
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [token, live]);

  const { reached, failed, failedAt } = progressCardToStageIndex(data.status);
  const perStageEvents = useMemo(() => {
    const bucket: Record<string, FlatEvent[]> = {};
    for (const s of STAGES) bucket[s.key] = [];
    for (const ev of events) {
      const s = STAGES.find((stg) => stg.matchStages(ev.stage));
      if (s) bucket[s.key].push(ev);
    }
    return bucket;
  }, [events]);

  // Auto-expand the failed stage so devs land on the error immediately.
  useEffect(() => {
    if (failed) {
      const failKey = STAGES[failedAt]?.key;
      if (failKey) {
        setExpanded((cur) => ({ ...cur, [failKey]: true }));
      }
    }
  }, [failed, failedAt]);

  const toggle = (key: string) =>
    setExpanded((cur) => ({ ...cur, [key]: !cur[key] }));

  const jenkinsBuildUrl =
    data.latestJenkinsBuildUrl ??
    events.find((e) => e.jenkinsBuildUrl)?.jenkinsBuildUrl ??
    null;
  const jenkinsConsoleUrl =
    data.latestJenkinsConsoleUrl ??
    events.find((e) => e.jenkinsConsoleUrl)?.jenkinsConsoleUrl ??
    null;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{data.repoSlug}</span>
        {data.team && (
          <span className="rounded-lg border border-[#e8871e]/40 bg-[#e8871e]/10 px-2 py-0.5 text-xs font-medium text-[#e8871e] dark:border-[#2a7f9e]/40 dark:bg-[#2a7f9e]/10 dark:text-[#5ab4c5]">
            {data.team}
          </span>
        )}
        <span className="rounded-lg border px-2 py-0.5 text-xs font-medium">
          {data.workloadKind}
          {data.role ? ` / ${data.role}` : ""}
        </span>
        <span className="rounded-lg border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {data.cluster}
        </span>
        <span className="rounded-lg border px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {data.environments.join(" + ")}
        </span>
        {typeof data.attempt === "number" && data.attempt > 1 && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            attempt {data.attempt}
          </span>
        )}
      </div>
      {data.manifestPath && (
        <div className="mb-4 font-mono text-[11px] text-muted-foreground">
          → {data.manifestPath}
        </div>
      )}

      {/* Global Jenkins links pulled from the deployment or any event.
          Handy shortcut when the stage-level buttons are collapsed. */}
      {(jenkinsBuildUrl || jenkinsConsoleUrl) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b pb-3">
          {jenkinsBuildUrl && (
            <a
              href={jenkinsBuildUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
            >
              <ExternalLink className="h-3 w-3" />
              Jenkins build
            </a>
          )}
          {jenkinsConsoleUrl && (
            <a
              href={jenkinsConsoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
            >
              <Terminal className="h-3 w-3" />
              Full console
            </a>
          )}
        </div>
      )}

      {/* Vertical stage list. Each stage row is a header + optional
          expanded body of nested events. Left rail is the vertical
          connector between stages — solid when done, animated when the
          next stage is currently in flight. */}
      <ol className="relative">
        {STAGES.map((stage, i) => {
          const isFail = failed && i === failedAt;
          const isCurrent = !failed && i === reached + 1 && i < STAGES.length;
          const isDone = i <= reached && !isFail;
          const stageState: StageState = isFail
            ? "failed"
            : isCurrent
              ? "current"
              : isDone
                ? "done"
                : "pending";
          const stageEvents = perStageEvents[stage.key] ?? [];
          // Nothing is expandable anymore — sub-events + Jenkins
          // console both live in the right column. Every stage row
          // is a static header now.
          const isExpandable = false;
          const isOpen = false;
          const isLast = i === STAGES.length - 1;

          return (
            <li
              key={stage.key}
              className="relative pb-4 pl-9 last:pb-0"
            >
              {/* Vertical connector between stage[i]'s icon and stage[i+1]'s
                  icon. Three flavors:
                    - fully done  → solid orange       (past both endpoints)
                    - flowing     → animated gradient  (this is the "still
                                    reaching the next step" segment: i is
                                    the last done stage and i+1 is current)
                    - grey        → not yet reached
                  The animated segment sits BELOW the last-completed icon,
                  visually pointing at the spinner on the current stage. */}
              {!isLast && (
                <span
                  aria-hidden
                  className={`absolute left-3 top-6 w-[2px] rounded-full ${
                    !failed && i === reached
                      ? "pulse-connector-vertical"
                      : isDone
                        ? "bg-[#e8871e] dark:bg-[#2a7f9e]"
                        : "bg-border"
                  }`}
                  style={{ height: "calc(100% - 1.25rem)" }}
                />
              )}

              {/* Header row. Only image_built is clickable (isExpandable);
                  other stages are static rows so keyboard nav + hover
                  don't hint at interactivity that isn't there. */}
              <button
                type="button"
                onClick={isExpandable ? () => toggle(stage.key) : undefined}
                disabled={!isExpandable}
                className={`group flex w-full items-start gap-3 text-left ${isExpandable ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className="absolute left-0 top-0 flex h-6 w-6 items-center justify-center">
                  {isCurrent && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#e8871e]/60 dark:bg-[#2a7f9e]/60" />
                  )}
                  <div
                    className={`relative flex h-6 w-6 items-center justify-center rounded-full ${
                      isFail
                        ? "bg-red-500 text-white"
                        : isCurrent
                          ? "border-2 border-[#e8871e] bg-background text-[#e8871e] dark:border-[#2a7f9e] dark:text-[#5ab4c5]"
                          : isDone
                            ? "bg-[#e8871e] text-white dark:bg-[#2a7f9e]"
                            : "border border-dashed bg-background text-muted-foreground"
                    }`}
                  >
                    {isFail ? (
                      <X className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isDone ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <CircleDashed className="h-3.5 w-3.5" />
                    )}
                  </div>
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        stageState === "pending"
                          ? "text-muted-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {stage.label}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                        stageState === "failed"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : stageState === "current"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : stageState === "done"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {stageState}
                    </span>
                    {stageEvents.length > 0 && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {stageEvents.length} event
                        {stageEvents.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {/* Right-pointing hook + trailing line for the
                        Jenkins-owned stages, so the eye connects each
                        of these rows to the sticky console panel on
                        the right. Non-Jenkins stages get no cue. */}
                    {(stage.key === "image_built" ||
                      stage.key === "manifest_pushed" ||
                      stage.key === "completed") && (
                      <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                        <span
                          aria-hidden
                          className="hidden h-[2px] w-8 rounded-full bg-gradient-to-r from-transparent to-[#e8871e]/50 dark:to-[#2a7f9e]/60 md:inline-block"
                        />
                        <ArrowRight className="h-3 w-3 text-[#e8871e] dark:text-[#5ab4c5]" />
                        <span className="hidden text-[10px] md:inline">
                          console
                        </span>
                      </div>
                    )}
                    {isExpandable && (
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isOpen ? "rotate-0" : "-rotate-90"
                        }`}
                      />
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {stage.detail}
                  </p>
                </div>
              </button>

              {/* Expanded body — sub-events nested under a subtle left
                  rail so the visual hierarchy matches Claude's chat
                  activity tracker. No card borders; each event is a
                  compact row with a small dot in the rail, monospace
                  action name, muted timestamp on the right, and only
                  the fields that carry information. Empty states are
                  intentionally silent — the parent row + stageEvents
                  count already communicate "nothing here yet". */}
              {isOpen && stageEvents.length > 0 && (
                <div className="mt-2 space-y-1 border-l pl-3 ml-[11px]">
                  {false && stageEvents.length === 0 && null}
                  {stageEvents.map((e, ei) => {
                    const key = `${stage.key}-${ei}-${e.ts}`;
                    const dotClass =
                      e.state === "failed"
                        ? "bg-red-500"
                        : e.state === "success" || e.state === "completed"
                          ? "bg-[#e8871e] dark:bg-[#2a7f9e]"
                          : "bg-blue-400";
                    return (
                      <div
                        key={key}
                        className="group relative flex items-start gap-2 rounded-md py-1 pr-1 transition-colors hover:bg-muted/40"
                      >
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-mono text-[11px] text-foreground">
                              {e.stage}
                            </span>
                            <span
                              className={`rounded-md px-1 py-0 text-[9px] font-medium ${stateBadgeClass(e.state)}`}
                            >
                              {e.state}
                            </span>
                            {e.buildId && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                #{e.buildId}
                              </span>
                            )}
                            {e.attempt > 1 && (
                              <span className="text-[10px] text-muted-foreground">
                                · attempt {e.attempt}
                              </span>
                            )}
                            <span
                              className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground"
                              title={new Date(e.ts).toLocaleString()}
                            >
                              {shortTime(e.ts)}
                            </span>
                          </div>
                          {(e.jenkinsBuildUrl || e.jenkinsConsoleUrl) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              {e.jenkinsBuildUrl && (
                                <a
                                  href={e.jenkinsBuildUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
                                >
                                  <ExternalLink className="mr-0.5 inline h-2.5 w-2.5" />
                                  Build
                                </a>
                              )}
                              {e.jenkinsConsoleUrl && (
                                <a
                                  href={e.jenkinsConsoleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
                                >
                                  <Terminal className="mr-0.5 inline h-2.5 w-2.5" />
                                  Console
                                </a>
                              )}
                            </div>
                          )}
                          {(e.logExcerpt || e.error) && (
                            <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-red-50/70 p-1.5 font-mono text-[10px] leading-tight text-red-900 dark:bg-red-950/30 dark:text-red-100">
                              {e.logExcerpt || e.error}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* The live Jenkins console now lives in the right-
                      hand column of the tracker page — the tracker
                      component only renders sub-events + ArgoCD hooks
                      here. Console moved out so it can stay visible
                      while the vertical tracker scrolls. */}

                  {/* Stage-level ArgoCD link (only shows on the terminal
                      "Completed" stage once the deployment is live). */}
                  {stage.key === "completed" &&
                    data.status === "completed" &&
                    data.argocdLinks?.[data.environments[0] ?? ""] && (
                      <a
                        href={
                          data.argocdLinks[data.environments[0] ?? ""] ?? "#"
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#e8871e] hover:underline dark:text-[#5ab4c5]"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open in ArgoCD
                      </a>
                    )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
