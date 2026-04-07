"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import {
  LayoutDashboard,
  Plus,
  Users,
  Bell,
  LogOut,
  Activity,
  Brain,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderOpen },
  { href: "/dashboard/endpoints/new", label: "Add Endpoint", icon: Plus },
  { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
  { href: "/dashboard/analytics", label: "AI Analytics", icon: Brain },
];

const adminItems = [
  { href: "/dashboard/users", label: "Users", icon: Users },
];

export function NavSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin";

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="flex h-screen w-64 flex-col rounded-r-3xl bg-[#1a1a1a] shadow-lg dark:bg-[#0c2d3f]">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8871e] shadow-md dark:bg-[#2a7f9e]">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <span className="text-xl font-bold tracking-tight text-white">Pulse</span>
      </div>

      {/* Navigation */}
      <nav className="mt-4 flex-1 space-y-1 px-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
              isActive(item.href)
                ? "bg-white/15 text-white shadow-sm"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            <item.icon
              className={cn(
                "h-5 w-5",
                isActive(item.href) ? "text-[#f0a830] dark:text-[#5ab4c5]" : ""
              )}
            />
            {item.label}
          </Link>
        ))}

        {isAdmin &&
          adminItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                isActive(item.href)
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5",
                  isActive(item.href) ? "text-[#f0a830] dark:text-[#5ab4c5]" : ""
                )}
              />
              {item.label}
            </Link>
          ))}
      </nav>

      {/* Footer */}
      <div className="px-4 pb-6">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white/60 transition-all duration-200 hover:bg-white/10 hover:text-red-400"
        >
          <LogOut className="h-5 w-5" />
          Log out
        </button>
      </div>
    </aside>
  );
}
