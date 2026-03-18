import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import CheckResult from "@/lib/models/check-result";
import { generateCSV } from "@/lib/services/export";
import { error } from "@/lib/helpers/api-response";
import { requireAuth } from "@/lib/helpers/auth-guard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuth();
    await connectDB();

    const { id } = await params;
    const searchParams = req.nextUrl.searchParams;
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const query: Record<string, unknown> = { endpointId: id };
    if (from || to) {
      query.checkedAt = {};
      if (from) (query.checkedAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (query.checkedAt as Record<string, unknown>).$lte = new Date(to);
    }

    const results = await CheckResult.find(query).sort({ checkedAt: -1 });
    const csv = generateCSV(results);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="endpoint-${id}-history.csv"`,
      },
    });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
