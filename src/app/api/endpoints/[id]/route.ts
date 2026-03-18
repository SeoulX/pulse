import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Endpoint from "@/lib/models/endpoint";
import CheckResult from "@/lib/models/check-result";
import { updateEndpointSchema } from "@/lib/validators/endpoint";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth, requireAdmin } from "@/lib/helpers/auth-guard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuth();
    await connectDB();
    const { id } = await params;
    const endpoint = await Endpoint.findById(id);
    if (!endpoint) return error("Endpoint not found", 404);
    return success(endpoint);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    await connectDB();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateEndpointSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      return error(`Invalid input: ${issues}`, 400);
    }

    const endpoint = await Endpoint.findByIdAndUpdate(id, parsed.data, {
      returnDocument: "after",
    });
    if (!endpoint) return error("Endpoint not found", 404);

    return success(endpoint);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    await connectDB();

    const { id } = await params;
    const endpoint = await Endpoint.findByIdAndDelete(id);
    if (!endpoint) return error("Endpoint not found", 404);

    // Purge check history
    await CheckResult.deleteMany({ endpointId: id });

    return new Response(null, { status: 204 });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
