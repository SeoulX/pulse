"use client";

import useSWR from "swr";
import { useProjectFilter } from "@/components/project-context";
import { cn } from "@/lib/utils";

interface ProjectWithCount {
  _id: string;
  name: string;
  color: string;
  endpointCount: number;
}

export function ProjectFilterBar() {
  const { data: projects } = useSWR<ProjectWithCount[]>("/api/projects");
  const { projectId, setProjectId } = useProjectFilter();

  if (!projects) return null;
  if (projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <button
        onClick={() => setProjectId(null)}
        className={cn(
          "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all",
          projectId === null
            ? "bg-[#1a1a1a] text-white shadow-sm dark:bg-[#164e63]"
            : "border bg-card text-muted-foreground hover:bg-muted"
        )}
      >
        All
      </button>
      {projects.map((p) => (
        <button
          key={p._id}
          onClick={() => setProjectId(p._id)}
          className={cn(
            "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all",
            projectId === p._id
              ? "text-white shadow-sm"
              : "border bg-card text-muted-foreground hover:bg-muted"
          )}
          style={
            projectId === p._id
              ? { backgroundColor: p.color || "#e8871e" }
              : undefined
          }
        >
          {p.name}
          <span className="ml-1.5 opacity-70">{p.endpointCount}</span>
        </button>
      ))}
    </div>
  );
}
