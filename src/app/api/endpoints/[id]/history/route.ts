import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import CheckResult from "@/lib/models/check-result";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth } from "@/lib/helpers/auth-guard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuth();
    await connectDB();

    const { id } = await params;
    const limit = parseInt(
      req.nextUrl.searchParams.get("limit") || "100",
      10
    );

    const results = await CheckResult.find({ endpointId: id })
      .sort({ checkedAt: -1 })
      .limit(Math.min(limit, 1000));

    return success(results);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
