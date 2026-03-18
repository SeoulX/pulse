import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const updateProjectSchema = createProjectSchema.partial();
