import { DashboardHeader } from "@/components/dashboard-header";
import { NotificationLog } from "@/components/notification-log";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Notification Log" />
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <NotificationLog />
      </div>
    </div>
  );
}
