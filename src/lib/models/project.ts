import mongoose, { Schema, type Document } from "mongoose";

export interface IProject extends Document {
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    color: { type: String, default: "#e8871e" },
  },
  { timestamps: true }
);

export default mongoose.models.Project ||
  mongoose.model<IProject>("Project", ProjectSchema);
