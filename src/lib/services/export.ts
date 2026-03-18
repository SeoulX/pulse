import { stringify } from "csv-stringify/sync";
import type { ICheckResult } from "@/lib/models/check-result";

export function generateCSV(results: ICheckResult[]): string {
  const records = results.map((r) => ({
    timestamp: r.checkedAt.toISOString(),
    status: r.status,
    status_code: r.statusCode ?? "",
    response_time_ms: r.responseTime ?? "",
    error: r.error ?? "",
  }));

  return stringify(records, {
    header: true,
    columns: ["timestamp", "status", "status_code", "response_time_ms", "error"],
  });
}
