"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { mutate } from "swr";
import { Rocket } from "lucide-react";

const WORKLOAD_KINDS = [
  { value: "Deployment", label: "Deploy" },
  { value: "StatefulSet", label: "STS" },
  { value: "ScaledJob", label: "SJ" },
  { value: "CronJob", label: "CJ" },
] as const;

const inputClass =
  "w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20";

export function DeploymentForm() {
  const [repoUrl, setRepoUrl] = useState("");
  const [workloadKind, setWorkloadKind] = useState("Deployment");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await apiFetch("/api/deployments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo_url: repoUrl,
          workload_kind: workloadKind,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to submit deployment");
      }

      const data = await res.json();
      setSuccess(
        `Deployment for ${data.repoSlug} submitted. Webhook added, tags v0.0.0-alpha and v0.0.0 pushed.`
      );
      setRepoUrl("");
      setWorkloadKind("Deployment");
      mutate("/api/deployments");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <h3 className="text-lg font-semibold">New Deployment Request</h3>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-xl bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
          {success}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Bitbucket Repository
          </label>
          <input
            type="text"
            required
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://bitbucket.org/metawhale/my_repo or repo slug"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Paste the Bitbucket URL or just the repo name
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Deployment Type
          </label>
          <div className="flex flex-wrap gap-2">
            {WORKLOAD_KINDS.map((kind) => (
              <button
                key={kind.value}
                type="button"
                onClick={() => setWorkloadKind(kind.value)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-all ${
                  workloadKind === kind.value
                    ? "border-[#e8871e] bg-[#e8871e]/10 text-[#e8871e] dark:border-[#2a7f9e] dark:bg-[#2a7f9e]/10 dark:text-[#5ab4c5]"
                    : "border-border hover:bg-muted"
                }`}
              >
                {kind.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">This will automatically:</p>
        <ol className="mt-2 list-inside list-decimal space-y-1">
          <li>Add the Jenkins webhook to the repo</li>
          <li>
            Push <code className="rounded bg-muted px-1 font-mono text-xs">v0.0.0-alpha</code> tag (staging bootstrap)
          </li>
          <li>
            Push <code className="rounded bg-muted px-1 font-mono text-xs">v0.0.0</code> tag (production bootstrap)
          </li>
        </ol>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
      >
        <Rocket className="h-4 w-4" />
        {loading ? "Deploying..." : "Submit Deployment"}
      </button>
    </form>
  );
}
