import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import Project from "@/lib/models/project";
import Endpoint from "@/lib/models/endpoint";
import { updateProjectSchema } from "@/lib/validators/project";
import { success, error } from "@/lib/helpers/api-response";
import { requireAuth, requireAdmin } from "@/lib/helpers/auth-guard";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    await connectDB();
    const { id } = await params;
    const project = await Project.findById(id);
    if (!project) return error("Project not found", 404);
    return success(project);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await connectDB();
    const { id } = await params;

    const body = await req.json();
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      return error(`Invalid input: ${issues}`, 400);
    }

    const project = await Project.findByIdAndUpdate(id, parsed.data, {
      returnDocument: "after",
    });
    if (!project) return error("Project not found", 404);
    return success(project);
  } catch (err) {
    return error((err as Error).message, 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    await connectDB();
    const { id } = await params;

    const project = await Project.findByIdAndDelete(id);
    if (!project) return error("Project not found", 404);

    // Unassign endpoints — don't delete them
    await Endpoint.updateMany({ projectId: id }, { projectId: null });

    return success({ deleted: true });
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
