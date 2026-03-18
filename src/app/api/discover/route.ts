import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/helpers/auth-guard";
import { success, error } from "@/lib/helpers/api-response";

const SPEC_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/api-docs",
  "/docs/openapi.json",
  "/v1/openapi.json",
  "/v2/openapi.json",
  "/v3/openapi.json",
  "/swagger/v1/swagger.json",
  "/api/openapi.json",
  "/api/swagger.json",
  "/api/v1/openapi.json",
  "/.well-known/openapi.json",
];

interface PathItem {
  summary?: string;
  description?: string;
  operationId?: string;
  [key: string]: unknown;
}

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, PathItem>>;
  servers?: Array<{ url: string }>;
  basePath?: string;
  host?: string;
  schemes?: string[];
}

interface DiscoveredEndpoint {
  method: string;
  path: string;
  fullUrl: string;
  summary: string;
  operationId: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head"];

function parseEndpoints(spec: OpenAPISpec, baseUrl: string): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];
  const paths = spec.paths || {};

  // Determine the base URL from the spec or use the provided one
  let resolvedBase = baseUrl.replace(/\/$/, "");
  if (spec.servers?.[0]?.url) {
    const serverUrl = spec.servers[0].url.replace(/\/$/, "");
    if (serverUrl.startsWith("http")) {
      resolvedBase = serverUrl;
    } else if (!resolvedBase.endsWith(serverUrl)) {
      // Only append if the base URL doesn't already end with this path
      resolvedBase = resolvedBase + serverUrl;
    }
  } else if (spec.host) {
    const scheme = spec.schemes?.[0] || "https";
    resolvedBase = `${scheme}://${spec.host}${spec.basePath || ""}`.replace(/\/$/, "");
  }

  // Extract the path portion of the base URL to detect overlap with spec paths
  let basePath = "";
  try {
    basePath = new URL(resolvedBase).pathname.replace(/\/$/, "");
  } catch { /* ignore */ }
  const origin = resolvedBase.replace(basePath, "").replace(/\/$/, "");

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, details] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      const info = details as PathItem;
      // If the path already starts with the base path prefix, use origin + path to avoid doubling
      const fullUrl = basePath && path.startsWith(basePath)
        ? `${origin}${path}`
        : `${resolvedBase}${path}`;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        fullUrl,
        summary: info.summary || info.description || "",
        operationId: info.operationId || "",
      });
    }
  }

  // Sort: GET first, then alphabetical by path
  endpoints.sort((a, b) => {
    if (a.method === "GET" && b.method !== "GET") return -1;
    if (a.method !== "GET" && b.method === "GET") return 1;
    return a.path.localeCompare(b.path);
  });

  return endpoints;
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth();

    const { baseUrl } = await req.json();
    if (!baseUrl || typeof baseUrl !== "string") {
      return error("baseUrl is required", 400);
    }

    // Normalize
    const normalized = baseUrl.replace(/\/$/, "");

    // Try each known spec path
    for (const specPath of SPEC_PATHS) {
      const url = `${normalized}${specPath}`;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("json")) continue;

        const spec = (await res.json()) as OpenAPISpec;
        if (!spec.paths || typeof spec.paths !== "object") continue;

        const endpoints = parseEndpoints(spec, normalized);
        return success({
          specUrl: url,
          apiTitle: spec.info?.title || "Unknown API",
          apiVersion: spec.info?.version || "",
          endpoints,
        });
      } catch {
        // Try next path
        continue;
      }
    }

    return error(
      "Could not find an OpenAPI/Swagger spec. Tried common paths like /openapi.json, /swagger.json, /api-docs. Make sure the API exposes a spec.",
      404
    );
  } catch (err) {
    return error((err as Error).message, 500);
  }
}
