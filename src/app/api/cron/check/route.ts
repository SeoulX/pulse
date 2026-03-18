import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import CheckResult from "@/lib/models/check-result";
import { checkEndpoint } from "@/lib/services/check-endpoint";
import { processNotifications } from "@/lib/services/notification";
import { success, error } from "@/lib/helpers/api-response";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return error("Unauthorized", 401);
  }

  try {
    await connectDB();

    const now = new Date();

    // Find all active endpoints due for a check
    const endpoints = await Endpoint.find({
      isActive: true,
      $or: [
        { lastCheckedAt: null },
        {
          $expr: {
            $lte: [
              "$lastCheckedAt",
              new Date(now.getTime() - 60 * 1000), // At least 1 minute ago
            ],
          },
        },
      ],
    });

    // Filter by individual intervals
    const dueEndpoints = endpoints.filter((ep) => {
      if (!ep.lastCheckedAt) return true;
      const elapsed = now.getTime() - ep.lastCheckedAt.getTime();
      return elapsed >= ep.interval * 1000;
    });

    // Check all due endpoints in parallel
    const results = await Promise.allSettled(
      dueEndpoints.map(async (endpoint) => {
        const result = await checkEndpoint(endpoint);

        // Persist check result
        await CheckResult.create({
          endpointId: endpoint._id,
          ...result,
        });

        // Update endpoint stats
        endpoint.lastCheckedAt = now;
        endpoint.lastStatus = result.status;
        endpoint.lastResponseTime = result.responseTime;
        endpoint.totalChecks += 1;
        if (result.status === "UP") {
          endpoint.successfulChecks += 1;
          endpoint.consecutiveFailures = 0;
        } else {
          endpoint.consecutiveFailures += 1;
        }
        endpoint.uptimePercentage =
          Math.round(
            (endpoint.successfulChecks / endpoint.totalChecks) * 10000
          ) / 100;

        await endpoint.save();

        // Process notifications
        await processNotifications(endpoint, result);

        return { endpoint: endpoint.name, ...result };
      })
    );

    const checked = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return success({
      checked,
      failed,
      total: dueEndpoints.length,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
