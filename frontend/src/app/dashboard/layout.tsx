"use client";

import { NavSidebar } from "@/components/nav-sidebar";
import { AutoChecker } from "@/components/auto-checker";
import { DinoMascot } from "@/components/dino-mascot";
import { SessionGuard } from "@/components/session-guard";
import { ProjectFilterProvider } from "@/components/project-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionGuard>
      <ProjectFilterProvider>
        <div className="flex h-screen bg-background">
          <AutoChecker />
          <DinoMascot />
          <NavSidebar />
          <main className="dot-grid flex-1 overflow-y-auto px-8 py-6">{children}</main>
        </div>
      </ProjectFilterProvider>
    </SessionGuard>
  );
}
