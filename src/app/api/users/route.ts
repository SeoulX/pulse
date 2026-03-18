import { connectDB } from "@/lib/mongodb";
import User from "@/lib/models/user";
import { success, error } from "@/lib/helpers/api-response";
import { requireAdmin } from "@/lib/helpers/auth-guard";

export async function GET() {
  try {
    await requireAdmin();
    await connectDB();

    const users = await User.find({}, "-hashedPassword").sort({
      createdAt: -1,
    });
    return success(users);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
