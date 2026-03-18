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

interface DiscoveredEndpoint {
  method: string;
  path: string;
  fullUrl: string;
  summary: string;
  operationId: string;
}

interface DiscoverResult {
  specUrl: string;
  apiTitle: string;
  apiVersion: string;
  endpoints: DiscoveredEndpoint[];
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

const inputClass =
  "w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20";

interface ExistingEndpoint {
  _id: string;
  name: string;
  alertEnabled: boolean;
  alertThreshold: number;
  notifications: {
    email: { enabled: boolean; address?: string };
    discord: { enabled: boolean; webhookUrl?: string };
    webhook: { enabled: boolean; url?: string };
  };
}

export function EndpointForm({
  mode,
  initialData,
  endpointId,
}: EndpointFormProps) {
  const router = useRouter();
  const { data: projects } = useSWR<ProjectData[]>("/api/projects");
  const { data: existingEndpoints } = useSWR<ExistingEndpoint[]>("/api/endpoints");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // API Discovery state
  const [discoverUrl, setDiscoverUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverError, setDiscoverError] = useState("");

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

  async function handleDiscover() {
    if (!discoverUrl) return;
    setDiscovering(true);
    setDiscoverError("");
    setDiscoverResult(null);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: discoverUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discovery failed");
      setDiscoverResult(data);
    } catch (err) {
      setDiscoverError((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  function selectDiscoveredEndpoint(ep: DiscoveredEndpoint) {
    setForm((prev) => ({
      ...prev,
      name: discoverResult?.apiTitle || ep.summary || ep.operationId || "Endpoint",
      url: ep.fullUrl,
      method: ep.method,
    }));
  }

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

      {/* API Discovery */}
      {mode === "create" && (
        <div className="space-y-3 rounded-2xl border border-dashed border-[#e8871e]/40 dark:border-[#2a7f9e]/40 p-5">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Discover from API
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Paste an API base URL to auto-discover endpoints from its OpenAPI/Swagger spec
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://api.example.com"
                value={discoverUrl}
                onChange={(e) => setDiscoverUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleDiscover();
                  }
                }}
                className={inputClass}
              />
              <button
                type="button"
                onClick={handleDiscover}
                disabled={discovering || !discoverUrl}
                className="shrink-0 rounded-xl bg-[#e8871e] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d07518] dark:bg-[#2a7f9e] dark:hover:bg-[#1e6b87] disabled:opacity-50"
              >
                {discovering ? "Scanning..." : "Discover"}
              </button>
            </div>
          </div>

          {discoverError && (
            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
              {discoverError}
            </div>
          )}

          {discoverResult && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {discoverResult.apiTitle}
                {discoverResult.apiVersion && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    v{discoverResult.apiVersion}
                  </span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">
                  ({discoverResult.endpoints.length} endpoints found)
                </span>
              </p>
              <div className="max-h-60 overflow-y-auto rounded-xl border divide-y">
                {discoverResult.endpoints.map((ep, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectDiscoveredEndpoint(ep)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-bold ${
                        ep.method === "GET"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : ep.method === "POST"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            : ep.method === "PUT" || ep.method === "PATCH"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : ep.method === "DELETE"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs truncate">
                      {ep.path}
                    </span>
                    {ep.summary && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {ep.summary}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Click an endpoint to auto-fill the form below
              </p>
            </div>
          )}
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
            className={inputClass}
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
            className={inputClass}
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
            className={inputClass}
            placeholder="https://api.example.com/health"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Method</label>
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
              className={inputClass}
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
              className={inputClass}
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
              className={inputClass}
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
              className={inputClass}
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
              className={`flex-1 ${inputClass}`}
            />
            <input
              type="text"
              placeholder="Value"
              value={headerValue}
              onChange={(e) => setHeaderValue(e.target.value)}
              className={`flex-1 ${inputClass}`}
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
              className={`${inputClass} font-mono`}
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
              {/* Copy notification config from existing endpoint */}
              {(() => {
                const configured = existingEndpoints?.filter(
                  (ep) =>
                    ep._id !== endpointId &&
                    ep.alertEnabled &&
                    (ep.notifications?.email?.enabled ||
                      ep.notifications?.discord?.enabled ||
                      ep.notifications?.webhook?.enabled)
                );
                if (!configured?.length) return null;
                return (
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Copy from existing
                    </label>
                    <select
                      value=""
                      onChange={(e) => {
                        const ep = configured.find((x) => x._id === e.target.value);
                        if (!ep) return;
                        setForm((prev) => ({
                          ...prev,
                          alertThreshold: ep.alertThreshold,
                          notifications: {
                            email: {
                              enabled: ep.notifications?.email?.enabled || false,
                              address: ep.notifications?.email?.address || "",
                            },
                            discord: {
                              enabled: ep.notifications?.discord?.enabled || false,
                              webhookUrl: ep.notifications?.discord?.webhookUrl || "",
                            },
                            webhook: {
                              enabled: ep.notifications?.webhook?.enabled || false,
                              url: ep.notifications?.webhook?.url || "",
                            },
                          },
                        }));
                      }}
                      className={inputClass}
                    >
                      <option value="">Select endpoint to copy config from...</option>
                      {configured.map((ep) => {
                        const channels: string[] = [];
                        if (ep.notifications?.email?.enabled) channels.push("Email");
                        if (ep.notifications?.discord?.enabled) channels.push("Discord");
                        if (ep.notifications?.webhook?.enabled) channels.push("Webhook");
                        return (
                          <option key={ep._id} value={ep._id}>
                            {ep.name} ({channels.join(", ")})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })()}

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
                  className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
                    className={inputClass}
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
