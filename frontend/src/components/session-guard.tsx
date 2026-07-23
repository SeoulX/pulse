"use client";

import { useAuth } from "@/components/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ShieldAlert } from "lucide-react";

// Routes a viewer must not reach, even by typing the URL. The sidebar
// already hides these links; this stops the direct-navigation path. The
// real enforcement is server-side (require_admin) — both layers matter,
// because this one only controls what renders.
const ADMIN_PREFIXES = [
  "/dashboard/databases",
  "/dashboard/infisical",
  "/dashboard/security",
  "/dashboard/users",
];

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const needsAdmin = ADMIN_PREFIXES.some((p) => pathname.startsWith(p));
  const blocked =
    status === "authenticated" && needsAdmin && user?.role !== "admin";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  if (blocked) {
    return (
      <div className="flex h-screen flex-1 items-center justify-center p-8">
        <div className="max-w-sm space-y-3 rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/30">
            <ShieldAlert className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold">Admin access required</h2>
          <p className="text-sm text-muted-foreground">
            This section is restricted to administrators. Ask an admin to
            upgrade your role if you need access.
          </p>
          <button
            onClick={() => router.replace("/dashboard")}
            className="mt-2 rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
          >
            Back to Overview
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
