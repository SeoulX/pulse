"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

import { API_URL } from "@/lib/api";

const POLL_MS = 3000;
// Cap the rolling buffer so a runaway build (npm install spam, kaniko
// layer verbose output) can't hog browser memory. Older lines get
// scrolled off the top just like a real terminal.
const MAX_CHARS = 60_000;

interface ConsoleResponse {
  text: string;
  offset: number;
  more: boolean;
  buildNumber: number | null;
  tag: string | null;
}

interface Props {
  token: string;
  live: boolean;
}

export function DeploymentConsoleTail({ token, live }: Props) {
  const [text, setText] = useState<string>("");
  const [meta, setMeta] = useState<{
    buildNumber: number | null;
    tag: string | null;
  }>({ buildNumber: null, tag: null });
  const offsetRef = useRef<number>(0);
  const preRef = useRef<HTMLPreElement>(null);
  const [showFallback, setShowFallback] = useState<boolean>(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `${API_URL}/api/deployments/track/${token}/console?start=${offsetRef.current}`,
        );
        if (!res.ok) return;
        const raw = (await res.json()) as ConsoleResponse;
        if (cancelled) return;
        if (raw.buildNumber == null) {
          setShowFallback(true);
          return;
        }
        setShowFallback(false);
        setMeta({ buildNumber: raw.buildNumber, tag: raw.tag });
        if (raw.text) {
          setText((prev) => {
            const next = prev + raw.text;
            return next.length > MAX_CHARS
              ? next.slice(next.length - MAX_CHARS)
              : next;
          });
          offsetRef.current = raw.offset;
        }
      } catch {
        /* poll again next tick */
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

  // Always scroll to bottom on new content. The user explicitly wanted
  // the tail to follow progress even after scrolling up — no manual
  // detach behavior (they can pause via the "Open in Jenkins" link if
  // they want a static log to read).
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  // No-op — kept to satisfy the pre's onScroll handler shape without
  // altering scroll stickiness. Auto-follow is unconditional above.
  const onScroll = () => {};

  const jenkinsBaseHref =
    meta.buildNumber && meta.tag
      ? `https://jenkins.media-meter.in/job/bitbucket/job/pulse_test_api/job/${meta.tag}/${meta.buildNumber}/console`
      : null;

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center justify-between gap-2 pl-1">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Terminal className="h-3 w-3" />
          <span>Live console</span>
          {meta.buildNumber !== null && (
            <span className="font-mono">#{meta.buildNumber}</span>
          )}
          {live && (
            <span className="rounded-md bg-green-100 px-1 py-0 text-[9px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              tailing
            </span>
          )}
        </div>
        {jenkinsBaseHref && (
          <a
            href={jenkinsBaseHref}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-muted-foreground hover:text-[#e8871e] hover:underline dark:hover:text-[#5ab4c5]"
          >
            Open in Jenkins
          </a>
        )}
      </div>
      {showFallback ? (
        <div className="rounded-md py-2 pl-1 text-[11px] text-muted-foreground">
          Waiting for Jenkins to pick up the tag build…
        </div>
      ) : (
        <pre
          ref={preRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto rounded-md bg-black/90 p-3 font-mono text-[11px] leading-snug text-green-100 dark:bg-black"
        >
          {text || "(waiting for output)"}
        </pre>
      )}
    </div>
  );
}
