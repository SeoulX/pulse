"use client";

import { useSession } from "next-auth/react";
import { Search, User } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";

export function DashboardHeader({ title }: { title: string }) {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");

  return (
    <div className="mb-8 flex items-center justify-between">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>

      <div className="flex items-center gap-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search endpoints, notifications"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-72 rounded-full border bg-card pl-10 pr-4 text-sm shadow-sm outline-none transition-all focus:ring-2 focus:ring-[#e8871e]/30 focus:border-[#e8871e] dark:focus:ring-[#2a7f9e]/30 dark:focus:border-[#2a7f9e]"
          />
        </div>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* User Avatar */}
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0a830] shadow-sm dark:bg-[#2a7f9e]">
            <User className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            {session?.user?.email?.split("@")[0]}
          </span>
        </div>
      </div>
    </div>
  );
}
