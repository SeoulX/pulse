import { z } from "zod";

// Allow empty strings to pass through as undefined for optional URL/email fields
const optionalEmail = z.union([
  z.string().email(),
  z.literal(""),
]).transform((v) => (v === "" ? undefined : v)).optional();

const optionalUrl = z.union([
  z.string().url(),
  z.literal(""),
]).transform((v) => (v === "" ? undefined : v)).optional();

const endpointFields = {
  projectId: z.string().nullable().optional(),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  expectedStatusCode: z.number().int().min(100).max(599),
  interval: z.number().int().min(60).max(3600),
  timeout: z.number().int().min(1).max(60),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  isActive: z.boolean().optional(),
  alertEnabled: z.boolean().optional(),
  alertThreshold: z.number().int().min(1).max(100).optional(),
  notifications: z
    .object({
      email: z
        .object({
          enabled: z.boolean(),
          address: optionalEmail,
        })
        .optional(),
      discord: z
        .object({
          enabled: z.boolean(),
          webhookUrl: optionalUrl,
        })
        .optional(),
      webhook: z
        .object({
          enabled: z.boolean(),
          url: optionalUrl,
        })
        .optional(),
    })
    .optional(),
};

export const createEndpointSchema = z.object(endpointFields);

// For updates: all fields optional, ignore extra mongoose fields
export const updateEndpointSchema = z.object(endpointFields).partial();
