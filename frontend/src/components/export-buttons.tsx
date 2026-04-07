"use client";

import { Download } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface ExportButtonsProps {
  endpointId: string;
}

async function downloadFile(path: string, filename: string) {
  const res = await apiFetch(path);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons({ endpointId }: ExportButtonsProps) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => downloadFile(`/api/export/endpoints/${endpointId}/csv`, `endpoint-${endpointId}.csv`)}
        className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
      >
        <Download className="h-4 w-4" />
        CSV
      </button>
      <button
        onClick={() => downloadFile(`/api/export/endpoints/${endpointId}/pdf`, `endpoint-${endpointId}.pdf`)}
        className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
      >
        <Download className="h-4 w-4" />
        PDF
      </button>
    </div>
  );
}
