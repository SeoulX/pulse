"use client";

import { Download } from "lucide-react";

interface ExportButtonsProps {
  endpointId: string;
}

export function ExportButtons({ endpointId }: ExportButtonsProps) {
  return (
    <div className="flex gap-2">
      <a
        href={`/api/export/endpoints/${endpointId}/csv`}
        className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
      >
        <Download className="h-4 w-4" />
        CSV
      </a>
      <a
        href={`/api/export/endpoints/${endpointId}/pdf`}
        className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
      >
        <Download className="h-4 w-4" />
        PDF
      </a>
    </div>
  );
}
