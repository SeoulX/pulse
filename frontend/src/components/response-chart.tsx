"use client";

import useSWR from "swr";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ResponseChartProps {
  endpointId: string;
}

export function ResponseChart({ endpointId }: ResponseChartProps) {
  const { data: results } = useSWR(
    `/api/endpoints/${endpointId}/history?limit=100`
  );

  if (!results || results.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <p className="text-muted-foreground">No data yet</p>
      </div>
    );
  }

  const chartData = [...results]
    .reverse()
    .map(
      (r: { checkedAt: string; responseTime: number | null; status: string }) => ({
        time: new Date(r.checkedAt).toLocaleTimeString(),
        responseTime: r.responseTime ?? 0,
        status: r.status,
      })
    );

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            label={{
              value: "ms",
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="responseTime"
            stroke="#e8871e"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
