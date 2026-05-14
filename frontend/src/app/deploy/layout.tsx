import Link from "next/link";
import { Activity } from "lucide-react";

export const metadata = {
  title: "Request Deployment — Pulse",
};

export default function DeployLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center gap-4 border-b bg-card px-8">
        <Link href="/deploy" className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-[9px] bg-[#1a1a1a] dark:bg-[#0c2d3f]">
            <Activity className="h-4 w-4 text-[#e8871e] dark:text-[#fbbf24]" />
          </div>
          <div className="text-base font-bold tracking-tight">Pulse</div>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="opacity-50">/</span>
          <span>Request deployment</span>
        </div>
        <div className="ml-auto flex items-center gap-3.5 text-sm text-muted-foreground">
          <span className="hidden md:inline">
            Have a tracking link? Open it directly.
          </span>
          <Link
            href="/login"
            className="font-medium text-[#e8871e] hover:text-[#c2410c] dark:text-[#fbbf24] dark:hover:text-[#fcd34d]"
          >
            DevOps login →
          </Link>
        </div>
      </header>

      <section className="border-b bg-gradient-to-b from-[#e8871e]/10 to-transparent px-10 pb-4 pt-5 dark:from-[#fbbf24]/10">
        <div className="mx-auto max-w-[1400px]">
          <h1 className="text-xl font-bold tracking-tight">Request a deployment</h1>
          <p className="text-sm text-muted-foreground">
            DevOps reviews each request. You&apos;ll get a tracking link — no
            login required to follow progress.
          </p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-10 py-6">
        {children}
      </main>
    </div>
  );
}
