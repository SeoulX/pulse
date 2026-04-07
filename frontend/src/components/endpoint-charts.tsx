"use client";

import useSWR from "swr";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface EndpointChartsProps {
  endpointId: string;
}

interface CheckResult {
  _id: string;
  checkedAt: string;
  status: "UP" | "DOWN" | "DEGRADED";
  statusCode: number | null;
  responseTime: number | null;
  error: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  UP: "#22c55e",
  DOWN: "#ef4444",
  DEGRADED: "#eab308",
};

export function EndpointCharts({ endpointId }: EndpointChartsProps) {
  const { data: results } = useSWR<CheckResult[]>(
    `/api/endpoints/${endpointId}/history?limit=200`
  );

  if (!results || results.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border bg-card">
        <p className="text-muted-foreground">No check data yet</p>
      </div>
    );
  }

  const sorted = [...results].reverse();

  // --- Response Time Area Chart ---
  const responseData = sorted.map((r) => ({
    time: new Date(r.checkedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    responseTime: r.responseTime ?? 0,
    status: r.status,
  }));

  // --- Status Distribution Pie ---
  const statusCounts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const pieData = Object.entries(statusCounts).map(([status, count]) => ({
    name: status,
    value: count,
  }));

  // --- Hourly Response Time Bar Chart ---
  const hourlyMap = new Map<string, { total: number; count: number; up: number; down: number; degraded: number }>();
  sorted.forEach((r) => {
    const hour = new Date(r.checkedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const entry = hourlyMap.get(hour) || { total: 0, count: 0, up: 0, down: 0, degraded: 0 };
    entry.total += r.responseTime ?? 0;
    entry.count += 1;
    if (r.status === "UP") entry.up += 1;
    else if (r.status === "DOWN") entry.down += 1;
    else entry.degraded += 1;
    hourlyMap.set(hour, entry);
  });
  const barData = Array.from(hourlyMap.entries()).map(([hour, data]) => ({
    hour,
    avgResponseTime: Math.round(data.total / data.count),
    up: data.up,
    down: data.down,
    degraded: data.degraded,
  }));

  // --- Uptime Timeline (status over time) ---
  const uptimeData = sorted.map((r) => ({
    time: new Date(r.checkedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    value: r.status === "UP" ? 1 : r.status === "DEGRADED" ? 0.5 : 0,
    status: r.status,
  }));

  // --- Stats Summary ---
  const responseTimes = results
    .map((r) => r.responseTime)
    .filter((t): t is number => t !== null);
  const avgResponse = responseTimes.length
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  const minResponse = responseTimes.length ? Math.min(...responseTimes) : 0;
  const maxResponse = responseTimes.length ? Math.max(...responseTimes) : 0;
  const p95Response = responseTimes.length
    ? responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)]
    : 0;

  return (
    <div className="space-y-8">
      {/* Performance Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs text-muted-foreground">Avg Response</p>
          <p className="text-2xl font-bold">{avgResponse}ms</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs text-muted-foreground">Min Response</p>
          <p className="text-2xl font-bold text-green-600">{minResponse}ms</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs text-muted-foreground">Max Response</p>
          <p className="text-2xl font-bold text-red-600">{maxResponse}ms</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs text-muted-foreground">P95 Response</p>
          <p className="text-2xl font-bold text-purple-600">{p95Response}ms</p>
        </div>
      </div>

      {/* Response Time Area Chart */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">Response Time Trend</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={responseData}>
              <defs>
                <linearGradient id="colorResponse" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e8871e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#e8871e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} label={{ value: "ms", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded border bg-card p-2 text-xs shadow">
                      <p className="font-medium">{d.time}</p>
                      <p>Response: {d.responseTime}ms</p>
                      <p>Status: <span style={{ color: STATUS_COLORS[d.status] }}>{d.status}</span></p>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="responseTime"
                stroke="#e8871e"
                strokeWidth={2}
                fill="url(#colorResponse)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Status Distribution Pie */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Status Distribution</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={({ name, percent }: any) =>
                    `${name} ${(percent * 100).toFixed(1)}%`
                  }
                >
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={STATUS_COLORS[entry.name] || "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Over Time Stacked Bar */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Status Over Time</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="up" stackId="status" fill="#22c55e" name="UP" />
                <Bar dataKey="degraded" stackId="status" fill="#eab308" name="DEGRADED" />
                <Bar dataKey="down" stackId="status" fill="#ef4444" name="DOWN" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Uptime Timeline */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">Uptime Timeline</h3>
        <div className="h-24 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={uptimeData}>
              <defs>
                <linearGradient id="colorUptime" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.5, 1]}
                tickFormatter={(v) =>
                  v === 1 ? "UP" : v === 0.5 ? "DEG" : "DOWN"
                }
                tick={{ fontSize: 10 }}
                width={40}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded border bg-card p-2 text-xs shadow">
                      <p>{d.time}: <span style={{ color: STATUS_COLORS[d.status] }}>{d.status}</span></p>
                    </div>
                  );
                }}
              />
              <Area
                type="stepAfter"
                dataKey="value"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#colorUptime)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
