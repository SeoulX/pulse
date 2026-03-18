import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import CheckResult from "@/lib/models/check-result";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth } from "@/lib/helpers/auth-guard";

export async function GET(req: NextRequest) {
  try {
    await requireAuth();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return error("ANTHROPIC_API_KEY not configured", 501);
    }

    await connectDB();

    const endpointId = req.nextUrl.searchParams.get("endpointId");

    let endpoints;
    if (endpointId) {
      const ep = await Endpoint.findById(endpointId);
      if (!ep) return error("Endpoint not found", 404);
      endpoints = [ep];
    } else {
      endpoints = await Endpoint.find().sort({ createdAt: -1 });
    }

    // Gather check history for each endpoint
    const endpointData = await Promise.all(
      endpoints.map(async (ep) => {
        const results = await CheckResult.find({ endpointId: ep._id })
          .sort({ checkedAt: -1 })
          .limit(50);

        const responseTimes = results
          .map((r) => r.responseTime)
          .filter((t): t is number => t !== null);

        return {
          name: ep.name,
          url: ep.url,
          method: ep.method,
          status: ep.lastStatus,
          isActive: ep.isActive,
          uptimePercentage: ep.uptimePercentage,
          totalChecks: ep.totalChecks,
          consecutiveFailures: ep.consecutiveFailures,
          avgResponseTime: responseTimes.length
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : null,
          minResponseTime: responseTimes.length ? Math.min(...responseTimes) : null,
          maxResponseTime: responseTimes.length ? Math.max(...responseTimes) : null,
          recentChecks: results.slice(0, 20).map((r) => ({
            status: r.status,
            responseTime: r.responseTime,
            error: r.error,
            checkedAt: r.checkedAt.toISOString(),
          })),
          statusBreakdown: {
            up: results.filter((r) => r.status === "UP").length,
            down: results.filter((r) => r.status === "DOWN").length,
            degraded: results.filter((r) => r.status === "DEGRADED").length,
          },
        };
      })
    );

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `You are an API reliability engineer analyzing health check data from a monitoring system. Analyze the following endpoint data and provide actionable insights.

DATA:
${JSON.stringify(endpointData, null, 2)}

Provide your analysis in this exact JSON format (no markdown, just raw JSON):
{
  "summary": "One paragraph overall health summary",
  "score": <0-100 health score>,
  "insights": [
    {
      "type": "warning|info|critical|success",
      "title": "Short title",
      "description": "Detailed explanation and recommendation"
    }
  ],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"]
}

Focus on:
- Uptime patterns and trends from recent checks
- Response time anomalies (spikes, increasing latency)
- Endpoints at risk of going down
- Performance optimization suggestions
- Any endpoints with concerning error patterns

Be specific with numbers. If there are no issues, say so.`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Parse the AI response
    try {
      const analysis = JSON.parse(text);
      return success({
        analysis,
        endpointCount: endpoints.length,
        generatedAt: new Date().toISOString(),
      });
    } catch {
      // If AI didn't return valid JSON, wrap it
      return success({
        analysis: {
          summary: text,
          score: null,
          insights: [],
          recommendations: [],
        },
        endpointCount: endpoints.length,
        generatedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
