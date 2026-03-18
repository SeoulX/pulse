import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/user";
import { registerSchema } from "@/lib/validators/user";
import { success, error } from "@/lib/helpers/api-response";
import { requireAdmin } from "@/lib/helpers/auth-guard";

export async function POST(req: NextRequest) {
  try {
    await connectDB();

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return error("Invalid input", 400);
    }

    const { email, password } = parsed.data;

    // First-run: if no users exist, first user becomes admin
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      // Require admin for subsequent registrations
      try {
        await requireAdmin();
      } catch {
        return error("Admin access required", 403);
      }
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return error("Email already registered", 409);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      hashedPassword,
      role: userCount === 0 ? "admin" : "viewer",
    });

    return success(
      { id: user._id, email: user.email, role: user.role },
      201
    );
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
