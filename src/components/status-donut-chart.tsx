"use client";

import useSWR from "swr";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useTheme } from "next-themes";
import type { DashboardStats } from "@/types";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";

export function StatusDonutChart() {
  const statsKey = useFilteredKey("/api/stats");
  const { data: stats } = useSWR<DashboardStats>(statsKey);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-32 w-32 animate-pulse rounded-full bg-muted" />
      </div>
    );
  }

  const data = [
    { name: "Up", value: stats.up, color: isDark ? "#2a7f9e" : "#e8871e" },
    { name: "Down", value: stats.down, color: "#ef4444" },
    { name: "Degraded", value: stats.degraded, color: isDark ? "#5ab4c5" : "#f0a830" },
  ].filter((d) => d.value > 0);

  const total = stats.total || 0;

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">No endpoints</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="relative h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{total}</span>
          <span className="text-xs uppercase text-muted-foreground">
            Endpoints
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-4">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-muted-foreground">
              {entry.name} ({entry.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
