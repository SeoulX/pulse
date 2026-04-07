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
  endpointCount?: number;
}

export interface DashboardStats {
  total: number;
  up: number;
  down: number;
  degraded: number;
  avgResponseTime: number;
  overallUptime: number;
}
