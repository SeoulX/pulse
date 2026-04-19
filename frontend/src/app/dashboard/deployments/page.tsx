import { DashboardHeader } from "@/components/dashboard-header";
import { DeploymentForm } from "@/components/deployment-form";
import { DeploymentList } from "@/components/deployment-list";

export default function DeploymentsPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Deployments" />
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <DeploymentForm />
      </div>
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <DeploymentList />
      </div>
    </div>
  );
}
