import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import CheckResult from "@/lib/models/check-result";
import { createEndpointSchema } from "@/lib/validators/endpoint";
import { checkEndpoint } from "@/lib/services/check-endpoint";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth, requireAdmin } from "@/lib/helpers/auth-guard";

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

    const endpoints = await Endpoint.find(filter).sort({ createdAt: -1 });
    return success(endpoints);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await connectDB();

    const body = await req.json();
    const parsed = createEndpointSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      return error(`Invalid input: ${issues}`, 400);
    }

    const endpoint = await Endpoint.create(parsed.data);

    // Trigger immediate first check
    const result = await checkEndpoint(endpoint);
    await CheckResult.create({
      endpointId: endpoint._id,
      ...result,
    });

    // Update endpoint stats
    endpoint.lastCheckedAt = new Date();
    endpoint.lastStatus = result.status;
    endpoint.lastResponseTime = result.responseTime;
    endpoint.totalChecks = 1;
    endpoint.successfulChecks = result.status === "UP" ? 1 : 0;
    endpoint.uptimePercentage = result.status === "UP" ? 100 : 0;
    endpoint.consecutiveFailures = result.status === "UP" ? 0 : 1;
    await endpoint.save();

    return success(endpoint, 201);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
