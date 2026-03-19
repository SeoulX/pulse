import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NavSidebar } from "@/components/nav-sidebar";
import { AutoChecker } from "@/components/auto-checker";
import { DinoMascot } from "@/components/dino-mascot";
import { SessionGuard } from "@/components/session-guard";
import { ProjectFilterProvider } from "@/components/project-context";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

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
