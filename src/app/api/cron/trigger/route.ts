import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import CheckResult from "@/lib/models/check-result";
import { checkEndpoint } from "@/lib/services/check-endpoint";
import { processNotifications } from "@/lib/services/notification";
import { success, error } from "@/lib/helpers/api-response";
import { requireAdmin } from "@/lib/helpers/auth-guard";

// Manual trigger for health checks (admin-only, no CRON_SECRET needed)
export async function POST() {
  try {
    await requireAdmin();
    await connectDB();

    const now = new Date();
    const endpoints = await Endpoint.find({ isActive: true });

    const dueEndpoints = endpoints.filter((ep) => {
      if (!ep.lastCheckedAt) return true;
      const elapsed = now.getTime() - ep.lastCheckedAt.getTime();
      return elapsed >= ep.interval * 1000;
    });

    const results = await Promise.allSettled(
      dueEndpoints.map(async (endpoint) => {
        const result = await checkEndpoint(endpoint);

        await CheckResult.create({
          endpointId: endpoint._id,
          ...result,
        });

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
        await processNotifications(endpoint, result);

        return { endpoint: endpoint.name, ...result };
      })
    );

    const checked = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return success({ checked, failed, total: dueEndpoints.length });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
