"use client";

import useSWR from "swr";
import { EndpointCard } from "@/components/endpoint-card";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";
import type { ProjectData } from "@/types";

interface EndpointData {
  _id: string;
  projectId: string | null;
  name: string;
  url: string;
  isActive: boolean;
  lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
  lastResponseTime: number | null;
  uptimePercentage: number;
  isAlerting: boolean;
  consecutiveFailures: number;
  createdAt: string;
  lastCheckedAt: string | null;
}

export function EndpointGrid() {
  const endpointsKey = useFilteredKey("/api/endpoints");
  const { data: endpoints, mutate } = useSWR<EndpointData[]>(endpointsKey);
  const { data: projects } = useSWR<ProjectData[]>("/api/projects");

  async function handleTogglePause(id: string, isActive: boolean) {
    await fetch(`/api/endpoints/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    mutate();
  }

  if (!endpoints) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-12 text-center shadow-sm">
        <p className="text-muted-foreground">
          No endpoints yet. Add your first endpoint to start monitoring.
        </p>
      </div>
    );
  }

  // Group by project
  const projectMap = new Map(
    (projects || []).map((p) => [p._id, p])
  );

  const grouped = new Map<string | null, EndpointData[]>();
  for (const ep of endpoints) {
    const key = ep.projectId || null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ep);
  }

  // Sort: projects first (alphabetically), then unassigned last
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const nameA = projectMap.get(a)?.name || "";
    const nameB = projectMap.get(b)?.name || "";
    return nameA.localeCompare(nameB);
  });

  // If only one group (no projects assigned), skip headers
  if (sortedKeys.length <= 1 && sortedKeys[0] === null) {
    return (
      <div className="space-y-3">
        {endpoints.map((endpoint) => (
          <EndpointCard
            key={endpoint._id}
            endpoint={endpoint}
            onTogglePause={handleTogglePause}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sortedKeys.map((projectId) => {
        const project = projectId ? projectMap.get(projectId) : null;
        const eps = grouped.get(projectId) || [];

        return (
          <div key={projectId || "unassigned"}>
            {/* Project header */}
            <div className="mb-3 flex items-center gap-2">
              {project && (
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
              )}
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {project ? project.name : "Unassigned"}
              </h3>
              <span className="text-xs text-muted-foreground">
                ({eps.length})
              </span>
            </div>

            <div className="space-y-3">
              {eps.map((endpoint) => (
                <EndpointCard
                  key={endpoint._id}
                  endpoint={endpoint}
                  onTogglePause={handleTogglePause}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
