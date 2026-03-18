export { auth as middleware } from "@/auth";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/endpoints/:path*",
    "/api/stats/:path*",
    "/api/export/:path*",
    "/api/notifications/:path*",
    "/api/users/:path*",
    "/api/projects/:path*",
  ],
};
