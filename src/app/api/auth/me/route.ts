import { auth } from "@/auth";
import { success, error } from "@/lib/helpers/api-response";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return error("Unauthorized", 401);
  }

  return success({
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
  });
}
