import mongoose, { Schema, type Document } from "mongoose";

export interface INotification extends Document {
  endpointId: mongoose.Types.ObjectId;
  channel: "email" | "discord" | "webhook";
  type: "alert" | "recovery";
  status: "sent" | "failed";
  message: string;
  error: string | null;
  sentAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  endpointId: {
    type: Schema.Types.ObjectId,
    ref: "Endpoint",
    required: true,
  },
  channel: {
    type: String,
    enum: ["email", "discord", "webhook"],
    required: true,
  },
  type: { type: String, enum: ["alert", "recovery"], required: true },
  status: { type: String, enum: ["sent", "failed"], required: true },
  message: { type: String },
  error: { type: String, default: null },
  sentAt: { type: Date, default: Date.now },
});

NotificationSchema.index({ sentAt: -1 });

export default mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema);
