"use client";

import useSWR from "swr";
import { useFilteredKey } from "@/lib/hooks/use-filtered-key";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useTheme } from "next-themes";

interface EndpointData {
  _id: string;
  name: string;
  lastResponseTime: number | null;
  lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
}

export function ResponseTrendChart() {
  const endpointsKey = useFilteredKey("/api/endpoints");
  const { data: endpoints } = useSWR<EndpointData[]>(endpointsKey);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (!endpoints) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-48 w-full animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">No endpoint data yet</p>
      </div>
    );
  }

  const chartData = endpoints.slice(0, 8).map((ep) => ({
    name: ep.name.length > 12 ? ep.name.substring(0, 12) + "..." : ep.name,
    response: ep.lastResponseTime ?? 0,
  }));

  const gridColor = isDark ? "#1e3a4a" : "#e5e7eb";
  const textColor = isDark ? "#8ba8b8" : "#6b7280";

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false}
            tickLine={false}
            unit="ms"
          />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: `1px solid ${gridColor}`,
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              fontSize: "12px",
              backgroundColor: isDark ? "#0f3347" : "#ffffff",
              color: isDark ? "#e0f0f8" : "#1a1a1a",
            }}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
          />
          <Bar
            dataKey="response"
            name="Response Time (ms)"
            fill={isDark ? "#5ab4c5" : "#f0a830"}
            radius={[6, 6, 0, 0]}
            barSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
