import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const updateRoleSchema = z.object({
  role: z.enum(["admin", "viewer"]),
});
