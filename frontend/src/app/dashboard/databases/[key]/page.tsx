import { DashboardHeader } from "@/components/dashboard-header";
import { DatabaseDashboard } from "@/components/database-dashboard";

export default async function DatabaseDashboardPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return (
    <div className="space-y-4">
      <DashboardHeader title="Database monitoring" />
      <DatabaseDashboard dbKey={key} />
    </div>
  );
}
