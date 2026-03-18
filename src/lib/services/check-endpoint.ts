import type { IEndpoint } from "@/lib/models/endpoint";
import type { CheckResultData } from "@/types";

export async function checkEndpoint(
  endpoint: IEndpoint
): Promise<CheckResultData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    endpoint.timeout * 1000
  );

  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (endpoint.headers) {
      endpoint.headers.forEach((value: string, key: string) => {
        headers[key] = value;
      });
    }

    const res = await fetch(endpoint.url, {
      method: endpoint.method,
      headers,
      body: ["POST", "PUT", "PATCH"].includes(endpoint.method)
        ? endpoint.body || undefined
        : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - start;

    let status: CheckResultData["status"];
    if (res.status === endpoint.expectedStatusCode) {
      status = "UP";
    } else if (res.status >= 500) {
      status = "DOWN";
    } else {
      status = "DEGRADED";
    }

    return {
      status,
      statusCode: res.status,
      responseTime,
      error: null,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const responseTime = Date.now() - start;
    return {
      status: "DOWN",
      statusCode: null,
      responseTime,
      error: (err as Error).message,
    };
  }
}
