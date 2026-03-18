"use client";

import useSWR from "swr";
import { Activity, ArrowUp, ArrowDown, Clock } from "lucide-react";
import type { DashboardStats } from "@/types";
import { cn } from "@/lib/utils";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";

export function StatsCards() {
  const statsKey = useFilteredKey("/api/stats");
  const { data: stats } = useSWR<DashboardStats>(statsKey);

  const cards = [
    {
      label: "Total Endpoints",
      value: stats?.total ?? "—",
      icon: Activity,
      light: "from-[#fef3e0] to-[#f5d9a0]",
      dark: "dark:from-[#b8e6ef] dark:to-[#7bcfe0]",
      iconBg: "bg-[#f0a830]/25 dark:bg-[#5ab4c5]/25",
      textColor: "text-[#3d2008] dark:text-[#0c2d3f]",
      labelColor: "text-[#7a5020] dark:text-[#164e63]",
    },
    {
      label: "Endpoints Up",
      value: stats?.up ?? "—",
      icon: ArrowUp,
      light: "from-[#f0a830] to-[#e8871e]",
      dark: "dark:from-[#5ab4c5] dark:to-[#2a7f9e]",
      iconBg: "bg-white/20",
      textColor: "text-white",
      labelColor: "text-white/90",
    },
    {
      label: "Endpoints Down",
      value: stats?.down ?? "—",
      icon: ArrowDown,
      light: "from-[#c45e1a] to-[#8b3a0f]",
      dark: "dark:from-[#2a7f9e] dark:to-[#164e63]",
      iconBg: "bg-white/15",
      textColor: "text-white",
      labelColor: "text-white/80",
    },
    {
      label: "Avg Response",
      value:
        stats?.avgResponseTime != null ? `${stats.avgResponseTime}ms` : "—",
      icon: Clock,
      light: "from-[#2d1b0e] to-[#1a1a1a]",
      dark: "dark:from-[#164e63] dark:to-[#0c2d3f]",
      iconBg: "bg-white/10",
      textColor: "text-white",
      labelColor: "text-white/70",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn(
            "relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 shadow-sm transition-shadow hover:shadow-md",
            card.light,
            card.dark
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className={cn("text-sm font-medium", card.labelColor)}>
                {card.label}
              </p>
              <p className={cn("mt-2 text-3xl font-bold", card.textColor)}>
                {card.value}
              </p>
            </div>
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                card.iconBg
              )}
            >
              <card.icon className={cn("h-5 w-5", card.textColor)} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
