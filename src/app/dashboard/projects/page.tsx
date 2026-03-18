"use client";

import { useState } from "react";
import useSWR from "swr";
import { Trash2, Pencil, FolderOpen } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";

interface ProjectWithCount {
  _id: string;
  name: string;
  color: string;
  endpointCount: number;
  createdAt: string;
}

export default function ProjectsPage() {
  const { data: projects, mutate } = useSWR<ProjectWithCount[]>("/api/projects");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#e8871e");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function startEdit(project: ProjectWithCount) {
    setEditingId(project._id);
    setName(project.name);
    setColor(project.color);
    setShowForm(true);
    setError("");
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setName("");
    setColor("#e8871e");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const url = editingId ? `/api/projects/${editingId}` : "/api/projects";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save project");
      }

      resetForm();
      mutate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, projectName: string) {
    if (
      !confirm(
        `Delete "${projectName}"? Endpoints will be unassigned, not deleted.`
      )
    )
      return;

    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="Projects" />

      <div className="flex justify-end">
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          + New Project
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="max-w-md space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Project Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Salina, Scoup, DC/ML, V4"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent"
              />
              <span className="text-xs text-muted-foreground">{color}</span>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border px-4 py-2 text-sm transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm text-white transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
            >
              {loading
                ? "Saving..."
                : editingId
                  ? "Update"
                  : "Create"}
            </button>
          </div>
        </form>
      )}

      {/* Project list */}
      {!projects ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border bg-muted"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border bg-card p-12 text-center shadow-sm">
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-muted-foreground">
            No projects yet. Create one to organize your endpoints.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project._id}
              className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <h3 className="font-semibold">{project.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(project)}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(project._id, project.name)}
                    className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{project.endpointCount} endpoints</span>
                <span>
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
