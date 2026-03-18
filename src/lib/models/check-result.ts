import mongoose, { Schema, type Document } from "mongoose";

export interface ICheckResult extends Document {
  endpointId: mongoose.Types.ObjectId;
  status: "UP" | "DOWN" | "DEGRADED";
  statusCode: number | null;
  responseTime: number | null;
  error: string | null;
  checkedAt: Date;
}

const DATA_RETENTION_DAYS = 30;

const CheckResultSchema = new Schema<ICheckResult>({
  endpointId: {
    type: Schema.Types.ObjectId,
    ref: "Endpoint",
    required: true,
  },
  status: {
    type: String,
    enum: ["UP", "DOWN", "DEGRADED"],
    required: true,
  },
  statusCode: { type: Number, default: null },
  responseTime: { type: Number, default: null },
  error: { type: String, default: null },
  checkedAt: { type: Date, default: Date.now },
});

CheckResultSchema.index({ endpointId: 1, checkedAt: -1 });
CheckResultSchema.index(
  { checkedAt: 1 },
  { expireAfterSeconds: DATA_RETENTION_DAYS * 24 * 60 * 60 }
);

export default mongoose.models.CheckResult ||
  mongoose.model<ICheckResult>("CheckResult", CheckResultSchema);
