import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Project from "@/lib/models/project";
import Endpoint from "@/lib/models/endpoint";
import { createProjectSchema } from "@/lib/validators/project";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth, requireAdmin } from "@/lib/helpers/auth-guard";

export async function GET() {
  try {
    await requireAuth();
    await connectDB();

    const projects = await Project.find().sort({ name: 1 }).lean();

    // Attach endpoint counts
    const counts = await Endpoint.aggregate([
      { $match: { projectId: { $ne: null } } },
      { $group: { _id: "$projectId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const result = projects.map((p) => ({
      ...p,
      endpointCount: countMap.get(String(p._id)) || 0,
    }));

    return success(result);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await connectDB();

    const body = await req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      return error(`Invalid input: ${issues}`, 400);
    }

    const existing = await Project.findOne({ name: parsed.data.name });
    if (existing) {
      return error("A project with that name already exists", 409);
    }

    const project = await Project.create(parsed.data);
    return success(project, 201);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
