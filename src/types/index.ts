import "next-auth";
import "@auth/core/jwt";

declare module "next-auth" {
  interface User {
    role?: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      role: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: string;
  }
}

export type EndpointStatus = "UP" | "DOWN" | "DEGRADED";
export type UserRole = "admin" | "viewer";
export type NotificationChannel = "email" | "discord" | "webhook";

export interface CheckResultData {
  status: EndpointStatus;
  statusCode: number | null;
  responseTime: number | null;
  error: string | null;
}

export interface ProjectData {
  _id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  total: number;
  up: number;
  down: number;
  degraded: number;
  avgResponseTime: number;
  overallUptime: number;
}
