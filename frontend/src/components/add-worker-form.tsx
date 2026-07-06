"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth-context";

interface WorkersSummaryComponent { name: string; workers: string[]; }
interface WorkersSummary {
  valid: boolean;
  queue_family?: string;
  zone?: string;
  component_count?: number;
  worker_count?: number;
  components?: WorkersSummaryComponent[];
  errors?: string[];
}
interface InspectResponse {
  slug: string;
  exists: boolean;
  has_workers_yml: boolean;
  workers_summary: WorkersSummary | null;
}

interface SubmitResponse {
  _id: string;
  trackUrl: string;
  status: string;
  addWorkerSpec?: Record<string, unknown>;
}

const inputClass =
  "w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20";

const WORKER_RE = /^[A-Z][A-Z0-9_]*$/;

export function AddWorkerForm() {
  const { user } = useAuth();
  const [repoUrl, setRepoUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [inspectErr, setInspectErr] = useState("");

  const [requestedBy, setRequestedBy] = useState("");
  const [component, setComponent] = useState("");
  const [worker, setWorker] = useState("");
  const [maxReplicas, setMaxReplicas] = useState<string>("");  // optional → defaults
  const [batch, setBatch] = useState<string>("");
  const [listName, setListName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState<SubmitResponse | null>(null);

  useEffect(() => {
    if (user?.email) setRequestedBy(user.email);
  }, [user]);

  // Auto-inspect on repo URL paste (debounced via simple effect).
  useEffect(() => {
    setInspect(null); setInspectErr("");
    if (!repoUrl.trim()) return;
    const slug = repoUrl.trim().replace(/^.*[:/]/, "").replace(/\.git$/, "");
    if (!slug) return;
    const t = setTimeout(async () => {
      setInspecting(true);
      try {
        const r = await apiFetch(`/api/deployments/inspect/${slug}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || "inspect failed");
        setInspect(data);
        // Pre-select first component for ergonomics.
        if (data?.workers_summary?.valid && (data.workers_summary.components || []).length > 0) {
          setComponent(data.workers_summary.components[0].name);
        }
      } catch (e: unknown) {
        setInspectErr(e instanceof Error ? e.message : String(e));
      } finally {
        setInspecting(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [repoUrl]);

  const existingWorkers = (inspect?.workers_summary?.components || [])
    .find((c) => c.name === component)?.workers || [];
  const workerNameOk = WORKER_RE.test(worker);
  const workerDup = existingWorkers.includes(worker);
  const canSubmit =
    !!inspect?.workers_summary?.valid &&
    !!component &&
    workerNameOk &&
    !workerDup &&
    !!requestedBy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr("");
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        repo_url: repoUrl,
        requested_by: requestedBy,
        component,
        worker,
      };
      if (maxReplicas) body.max = Number(maxReplicas);
      if (batch)       body.batch = Number(batch);
      if (listName)    body.list_name = listName;

      const r = await apiFetch("/api/deployments/add-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.detail?.message || data?.detail || "submit failed");
      setResult(data);
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success card ──────────────────────────────────────────────────
  if (result) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-900/50 dark:bg-emerald-900/20">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Add-worker request queued — awaiting approval</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">id</dt><dd className="font-mono text-xs">{result._id}</dd>
          <dt className="text-muted-foreground">status</dt><dd className="font-mono text-xs">{result.status}</dd>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <Link href={result.trackUrl} className="inline-flex items-center gap-1 rounded-lg bg-[#e8871e] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#d97706] dark:bg-[#2a7f9e] dark:hover:bg-[#236680]">
            Open tracker
            <ArrowRight className="h-3 w-3" />
          </Link>
          <button
            type="button"
            onClick={() => { setResult(null); setWorker(""); }}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <div>
        <label className="mb-1 block text-sm font-medium">Repository</label>
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="metawhale/pulse_test_scrapy"
          className={`${inputClass} font-mono text-xs`}
          required
        />
        {inspecting && <p className="mt-1 text-xs text-muted-foreground">Inspecting…</p>}
        {inspectErr && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> {inspectErr}
          </p>
        )}
        {inspect && !inspect.has_workers_yml && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Repo has no devops/workers.yml — add via a normal deploy first.
          </p>
        )}
        {inspect?.workers_summary?.valid && (
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            Found {inspect.workers_summary.worker_count} workers across {inspect.workers_summary.component_count} components.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Requested by</label>
        <input
          type="email"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="you@seven-gen.com"
          className={inputClass}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Component</label>
          <select
            value={component}
            onChange={(e) => setComponent(e.target.value)}
            disabled={!inspect?.workers_summary?.valid}
            className={inputClass}
          >
            <option value="">— pick —</option>
            {(inspect?.workers_summary?.components || []).map((c) => (
              <option key={c.name} value={c.name}>{c.name}  ({c.workers.length} workers)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Worker name</label>
          <input
            type="text"
            value={worker}
            onChange={(e) => setWorker(e.target.value.toUpperCase())}
            placeholder="HEADLESS_CHROME"
            className={`${inputClass} font-mono text-xs uppercase`}
            required
          />
          {worker && !workerNameOk && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Must match <code className="font-mono">^[A-Z][A-Z0-9_]*$</code>
            </p>
          )}
          {worker && workerDup && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Already exists under {component}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">max (replicas)</label>
          <input
            type="number"
            min={1}
            max={500}
            value={maxReplicas}
            onChange={(e) => setMaxReplicas(e.target.value)}
            placeholder="40 (default)"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">batch</label>
          <input
            type="number"
            min={1}
            max={10000}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="10 (default)"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">list_name (optional Redis key override)</label>
        <input
          type="text"
          value={listName}
          onChange={(e) => setListName(e.target.value)}
          placeholder="leave blank to auto-synth"
          className={`${inputClass} font-mono text-xs`}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Auto-synth shape: <code className="font-mono">&lt;env&gt;:&lt;queue_family&gt;:&lt;app&gt;:&lt;zone&gt;:&lt;component&gt;:&lt;worker_lowercase&gt;</code>
        </p>
      </div>

      {submitErr && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {submitErr}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-xl bg-[#e8871e] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#d97706] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#2a7f9e] dark:hover:bg-[#236680]"
      >
        {submitting ? "Submitting…" : "Submit add-worker request"}
      </button>
    </form>
  );
}
