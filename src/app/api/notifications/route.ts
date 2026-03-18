import { connectDB } from "@/lib/mongodb";
import Notification from "@/lib/models/notification";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth } from "@/lib/helpers/auth-guard";

export async function GET() {
  try {
    await requireAuth();
    await connectDB();

    const notifications = await Notification.find()
      .sort({ sentAt: -1 })
      .limit(50)
      .populate("endpointId", "name url");

    return success(notifications);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
