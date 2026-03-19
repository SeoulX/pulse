import { DashboardHeader } from "@/components/dashboard-header";
import { EndpointForm } from "@/components/endpoint-form";

export default function NewEndpointPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Add New Endpoint" />
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <EndpointForm mode="create" />
      </div>
    </div>
  );
}
