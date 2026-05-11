"use client";

import { DeploymentForm } from "@/components/deployment-form";

export function DeployView() {
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <DeploymentForm />
    </div>
  );
}
