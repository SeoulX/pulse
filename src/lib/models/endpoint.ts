import mongoose, { Schema, type Document } from "mongoose";

export interface IEndpoint extends Document {
  projectId: mongoose.Types.ObjectId | null;
  name: string;
  url: string;
  method: string;
  expectedStatusCode: number;
  interval: number;
  timeout: number;
  headers: Map<string, string>;
  body: string;
  isActive: boolean;
  alertEnabled: boolean;
  alertThreshold: number;
  consecutiveFailures: number;
  isAlerting: boolean;
  lastAlertedAt: Date | null;
  notifications: {
    email: { enabled: boolean; address?: string };
    discord: { enabled: boolean; webhookUrl?: string };
    webhook: { enabled: boolean; url?: string };
  };
  lastCheckedAt: Date | null;
  lastStatus: "UP" | "DOWN" | "DEGRADED" | null;
  lastResponseTime: number | null;
  totalChecks: number;
  successfulChecks: number;
  uptimePercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

const EndpointSchema = new Schema<IEndpoint>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    method: {
      type: String,
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      default: "GET",
    },
    expectedStatusCode: { type: Number, default: 200 },
    interval: { type: Number, default: 60, min: 60, max: 3600 },
    timeout: { type: Number, default: 10, min: 1, max: 60 },
    headers: { type: Map, of: String, default: {} },
    body: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    alertEnabled: { type: Boolean, default: false },
    alertThreshold: { type: Number, default: 3 },
    consecutiveFailures: { type: Number, default: 0 },
    isAlerting: { type: Boolean, default: false },
    lastAlertedAt: { type: Date, default: null },
    notifications: {
      email: {
        enabled: { type: Boolean, default: false },
        address: { type: String },
      },
      discord: {
        enabled: { type: Boolean, default: false },
        webhookUrl: { type: String },
      },
      webhook: {
        enabled: { type: Boolean, default: false },
        url: { type: String },
      },
    },
    lastCheckedAt: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ["UP", "DOWN", "DEGRADED", null],
      default: null,
    },
    lastResponseTime: { type: Number, default: null },
    totalChecks: { type: Number, default: 0 },
    successfulChecks: { type: Number, default: 0 },
    uptimePercentage: { type: Number, default: 100 },
  },
  { timestamps: true }
);

EndpointSchema.index({ isActive: 1 });
EndpointSchema.index({ lastCheckedAt: 1 });

export default mongoose.models.Endpoint ||
  mongoose.model<IEndpoint>("Endpoint", EndpointSchema);
