import mongoose, { Schema, type Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  hashedPassword: string;
  role: "admin" | "viewer";
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  hashedPassword: { type: String, required: true },
  role: { type: String, enum: ["admin", "viewer"], default: "viewer" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.User ||
  mongoose.model<IUser>("User", UserSchema);
