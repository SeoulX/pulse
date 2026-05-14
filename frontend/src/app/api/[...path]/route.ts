import { NextRequest, NextResponse } from "next/server";

// Catch-all proxy for browser /api/* calls → in-cluster pulse-api. Replaces
// next.config.mjs rewrites, which bake the destination URL into the routes
// manifest at build time (so configMap env at runtime can't change it).
// Reading process.env in the handler body re-evaluates it per request, so
// the same image works in any cluster as long as PULSE_API_INTERNAL_URL is
// set on the pod.
//
// Hop-by-hop headers must be stripped before forwarding — the runtime fetch
// adds its own connection management, and passing through `connection`,
// `host`, etc. breaks the upstream response.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest) {
  const target = process.env.PULSE_API_INTERNAL_URL || "http://localhost:8000";
  const upstream = `${target}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.arrayBuffer();
  }

  const res = await fetch(upstream, init);
  const respHeaders = new Headers();
  res.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) respHeaders.set(k, v);
  });
  return new NextResponse(res.body, { status: res.status, headers: respHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH, proxy as OPTIONS };
