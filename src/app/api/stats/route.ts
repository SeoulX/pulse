import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth } from "@/lib/helpers/auth-guard";
import type { DashboardStats } from "@/types";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    await connectDB();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");

    const filter: Record<string, unknown> = {};
    if (projectId === "none") {
      filter.projectId = null;
    } else if (projectId) {
      filter.projectId = projectId;
    }

    const endpoints = await Endpoint.find(filter);

    const stats: DashboardStats = {
      total: endpoints.length,
      up: endpoints.filter((e) => e.lastStatus === "UP").length,
      down: endpoints.filter((e) => e.lastStatus === "DOWN").length,
      degraded: endpoints.filter((e) => e.lastStatus === "DEGRADED").length,
      avgResponseTime:
        endpoints.length > 0
          ? Math.round(
              endpoints.reduce(
                (sum, e) => sum + (e.lastResponseTime || 0),
                0
              ) / endpoints.filter((e) => e.lastResponseTime != null).length
            ) || 0
          : 0,
      overallUptime:
        endpoints.length > 0
          ? Math.round(
              (endpoints.reduce((sum, e) => sum + e.uptimePercentage, 0) /
                endpoints.length) *
                100
            ) / 100
          : 100,
    };

    return success(stats);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
