import { DashboardHeader } from "@/components/dashboard-header";
import { DatabasesView } from "@/components/databases-view";

export default function DatabasesPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Databases" />
      <div className="rounded-2xl border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Auto-discovered from{" "}
        <code className="rounded bg-card px-1 font-mono">global/devops-global-secrets</code>{" "}
        — connection strings live in the cluster Secret, never in code. Probes run on demand.
      </div>
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <DatabasesView />
      </div>
    </div>
  );
}
