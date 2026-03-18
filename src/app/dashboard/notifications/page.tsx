import { DashboardHeader } from "@/components/dashboard-header";
import { NotificationLog } from "@/components/notification-log";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Notification Log" />
      <NotificationLog />
    </div>
  );
}
