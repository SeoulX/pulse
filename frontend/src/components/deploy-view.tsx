"use client";

import { useEffect, useState } from "react";

import {
  DeploymentForm,
  type SubmittedDeployment,
} from "@/components/deployment-form";
import { DeploymentProgress } from "@/components/deployment-progress";

const STORAGE_KEY = "pulse.deploySubmissions";
const MAX_ITEMS = 10;

function loadFromStorage(): SubmittedDeployment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function DeployView() {
  const [submissions, setSubmissions] = useState<SubmittedDeployment[]>([]);

  useEffect(() => {
    setSubmissions(loadFromStorage());
  }, []);

  const persist = (next: SubmittedDeployment[]) => {
    setSubmissions(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable (private mode); ignore
    }
  };

  const handleSubmitted = (dep: SubmittedDeployment) => {
    const deduped = submissions.filter((s) => s._id !== dep._id);
    persist([dep, ...deduped].slice(0, MAX_ITEMS));
  };

  const handleClear = () => persist([]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 rounded-2xl border bg-card p-6 shadow-sm">
        <DeploymentForm onSubmitted={handleSubmitted} />
      </div>
      <div className="min-w-0">
        <DeploymentProgress submissions={submissions} onClear={handleClear} />
      </div>
    </div>
  );
}
