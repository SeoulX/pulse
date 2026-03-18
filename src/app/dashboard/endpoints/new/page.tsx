import { DashboardHeader } from "@/components/dashboard-header";
import { EndpointForm } from "@/components/endpoint-form";

export default function NewEndpointPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Add New Endpoint" />
      <EndpointForm mode="create" />
    </div>
  );
}
