import Link from "next/link";

import { DashboardHeader } from "@/components/dashboard-header";
import { DeploymentList } from "@/components/deployment-list";

export default function DeploymentsPage() {
  return (
    <div className="space-y-6">
      <DashboardHeader title="Deployments" />
      <div className="flex items-center justify-between rounded-2xl border bg-muted/40 px-6 py-4 text-sm">
        <span className="text-muted-foreground">
          The submission form is now public. Share this link with devs:
        </span>
        <Link
          href="/deploy"
          className="font-mono text-xs font-medium text-[#e8871e] hover:underline dark:text-[#5ab4c5]"
        >
          /deploy
        </Link>
      </div>
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <DeploymentList />
      </div>
    </div>
  );
}
