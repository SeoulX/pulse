import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/user";
import { updateRoleSchema } from "@/lib/validators/user";
import { success, error } from "@/lib/helpers/api-response";
import { requireAdmin } from "@/lib/helpers/auth-guard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    await connectDB();

    const { id } = await params;
    const body = await req.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 400);

    const user = await User.findByIdAndUpdate(id, parsed.data, {
      returnDocument: "after",
      select: "-hashedPassword",
    });
    if (!user) return error("User not found", 404);

    return success(user);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    await connectDB();

    const { id } = await params;

    // Prevent self-deletion
    if (session.user.id === id) {
      return error("Cannot delete your own account", 400);
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) return error("User not found", 404);

    return new Response(null, { status: 204 });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
