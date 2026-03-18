"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import type { ProjectData } from "@/types";

interface EndpointFormProps {
  mode: "create" | "edit";
  initialData?: Record<string, unknown>;
  endpointId?: string;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function EndpointForm({
  mode,
  initialData,
  endpointId,
}: EndpointFormProps) {
  const router = useRouter();
  const { data: projects } = useSWR<ProjectData[]>("/api/projects");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    projectId: (initialData?.projectId as string) || "",
    name: (initialData?.name as string) || "",
    url: (initialData?.url as string) || "",
    method: (initialData?.method as string) || "GET",
    expectedStatusCode: (initialData?.expectedStatusCode as number) || 200,
    interval: (initialData?.interval as number) || 60,
    timeout: (initialData?.timeout as number) || 10,
    headers: (initialData?.headers as Record<string, string>) || {},
    body: (initialData?.body as string) || "",
    alertEnabled: (initialData?.alertEnabled as boolean) || false,
    alertThreshold: (initialData?.alertThreshold as number) || 3,
    notifications: (initialData?.notifications as Record<string, unknown>) || {
      email: { enabled: false, address: "" },
      discord: { enabled: false, webhookUrl: "" },
      webhook: { enabled: false, url: "" },
    },
  });

  const [headerKey, setHeaderKey] = useState("");
  const [headerValue, setHeaderValue] = useState("");

  function addHeader() {
    if (!headerKey) return;
    setForm((prev) => ({
      ...prev,
      headers: { ...prev.headers, [headerKey]: headerValue },
    }));
    setHeaderKey("");
    setHeaderValue("");
  }

  function removeHeader(key: string) {
    setForm((prev) => {
      const headers = { ...prev.headers };
      delete headers[key];
      return { ...prev, headers };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const url =
        mode === "create"
          ? "/api/endpoints"
          : `/api/endpoints/${endpointId}`;
      const method = mode === "create" ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          projectId: form.projectId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save endpoint");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Project</label>
          <select
            value={form.projectId}
            onChange={(e) =>
              setForm({ ...form, projectId: e.target.value || "" })
            }
            className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
          >
            <option value="">No Project</option>
            {projects?.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            placeholder="Payment API"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">URL</label>
          <input
            type="url"
            required
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            placeholder="https://api.example.com/health"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Method</label>
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
              className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Expected Status
            </label>
            <input
              type="number"
              value={form.expectedStatusCode}
              onChange={(e) =>
                setForm({
                  ...form,
                  expectedStatusCode: parseInt(e.target.value),
                })
              }
              className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Interval (seconds)
            </label>
            <input
              type="number"
              min={60}
              max={3600}
              value={form.interval}
              onChange={(e) =>
                setForm({ ...form, interval: parseInt(e.target.value) })
              }
              className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Timeout (seconds)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={form.timeout}
              onChange={(e) =>
                setForm({ ...form, timeout: parseInt(e.target.value) })
              }
              className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
          </div>
        </div>

        {/* Headers */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            Headers (optional)
          </label>
          {Object.entries(form.headers).map(([key, value]) => (
            <div key={key} className="mb-1 flex items-center gap-2 text-sm">
              <code className="rounded bg-muted px-2 py-1">
                {key}: {value}
              </code>
              <button
                type="button"
                onClick={() => removeHeader(key)}
                className="text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Key"
              value={headerKey}
              onChange={(e) => setHeaderKey(e.target.value)}
              className="flex-1 w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
            <input
              type="text"
              placeholder="Value"
              value={headerValue}
              onChange={(e) => setHeaderValue(e.target.value)}
              className="flex-1 w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
            <button
              type="button"
              onClick={addHeader}
              className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              Add
            </button>
          </div>
        </div>

        {/* Body for POST/PUT */}
        {["POST", "PUT", "PATCH"].includes(form.method) && (
          <div>
            <label className="mb-1 block text-sm font-medium">
              Request Body (optional)
            </label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
              className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20 font-mono"
              placeholder='{"key": "value"}'
            />
          </div>
        )}

        {/* Alerting */}
        <div className="space-y-3 rounded-2xl border p-5">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.alertEnabled}
              onChange={(e) =>
                setForm({ ...form, alertEnabled: e.target.checked })
              }
              className="rounded"
            />
            <span className="text-sm font-medium">Enable alerting</span>
          </label>

          {form.alertEnabled && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  After consecutive failures
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.alertThreshold}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      alertThreshold: parseInt(e.target.value),
                    })
                  }
                  className="w-32 w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Notification Channels</p>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      (
                        form.notifications.email as {
                          enabled: boolean;
                          address: string;
                        }
                      )?.enabled || false
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          email: {
                            ...(form.notifications.email as Record<string, unknown>),
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-sm">Email</span>
                </label>
                {(
                  form.notifications.email as {
                    enabled: boolean;
                    address: string;
                  }
                )?.enabled && (
                  <input
                    type="email"
                    placeholder="ops@company.com"
                    value={
                      (
                        form.notifications.email as {
                          enabled: boolean;
                          address: string;
                        }
                      )?.address || ""
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          email: {
                            ...(form.notifications.email as Record<string, unknown>),
                            address: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
                  />
                )}

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      (
                        form.notifications.discord as {
                          enabled: boolean;
                          webhookUrl: string;
                        }
                      )?.enabled || false
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          discord: {
                            ...(form.notifications.discord as Record<string, unknown>),
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-sm">Discord</span>
                </label>
                {(
                  form.notifications.discord as {
                    enabled: boolean;
                    webhookUrl: string;
                  }
                )?.enabled && (
                  <input
                    type="url"
                    placeholder="https://discord.com/api/webhooks/..."
                    value={
                      (
                        form.notifications.discord as {
                          enabled: boolean;
                          webhookUrl: string;
                        }
                      )?.webhookUrl || ""
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          discord: {
                            ...(form.notifications.discord as Record<string, unknown>),
                            webhookUrl: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
                  />
                )}

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      (
                        form.notifications.webhook as {
                          enabled: boolean;
                          url: string;
                        }
                      )?.enabled || false
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          webhook: {
                            ...(form.notifications.webhook as Record<string, unknown>),
                            enabled: e.target.checked,
                          },
                        },
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-sm">Custom Webhook</span>
                </label>
                {(
                  form.notifications.webhook as {
                    enabled: boolean;
                    url: string;
                  }
                )?.enabled && (
                  <input
                    type="url"
                    placeholder="https://my-alerts.com/hook"
                    value={
                      (
                        form.notifications.webhook as {
                          enabled: boolean;
                          url: string;
                        }
                      )?.url || ""
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        notifications: {
                          ...form.notifications,
                          webhook: {
                            ...(form.notifications.webhook as Record<string, unknown>),
                            url: e.target.value,
                          },
                        },
                      })
                    }
                    className="w-full w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f] disabled:opacity-50"
        >
          {loading
            ? "Saving..."
            : mode === "create"
              ? "Create Endpoint"
              : "Update Endpoint"}
        </button>
      </div>
    </form>
  );
}
