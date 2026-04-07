import { DashboardHeader } from "@/components/dashboard-header";
import { StatsCards } from "@/components/stats-cards";
import { ResponseTrendChart } from "@/components/response-trend-chart";
import { StatusDonutChart } from "@/components/status-donut-chart";
import { RecentChecksWidget } from "@/components/recent-checks-widget";
import { NotificationsWidget } from "@/components/notifications-widget";
import { UptimeOverviewClient } from "@/components/uptime-overview";
import { RunChecksButton } from "@/components/run-checks-button";
import { ProjectFilterBar } from "@/components/project-filter-bar";
import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Dashboard" />

      {/* Project Filter + Actions */}
      <div className="flex items-center justify-between gap-4">
        <ProjectFilterBar />
        <div className="flex shrink-0 items-center gap-2">
          <RunChecksButton />
          <Link
            href="/dashboard/endpoints/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
          >
            + Add Endpoint
          </Link>
        </div>
      </div>

      {/* Stats Cards Row */}
      <StatsCards />

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-2xl border bg-card p-6 shadow-sm lg:col-span-5">
          <h2 className="mb-4 text-lg font-semibold">Endpoint Performance</h2>
          <div className="h-64">
            <ResponseTrendChart />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm lg:col-span-3">
          <h2 className="mb-2 text-lg font-semibold">Status</h2>
          <div className="h-64">
            <StatusDonutChart />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm lg:col-span-4">
          <h2 className="mb-4 text-lg font-semibold">Endpoints</h2>
          <RecentChecksWidget />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Recent Notifications</h2>
          <NotificationsWidget />
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Uptime Overview</h2>
          <UptimeOverviewClient />
        </div>
      </div>
    </div>
  );
}
