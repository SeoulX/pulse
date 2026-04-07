"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface DeleteEndpointDialogProps {
  endpointId: string;
  endpointName: string;
}

export function DeleteEndpointDialog({
  endpointId,
  endpointName,
}: DeleteEndpointDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await apiFetch(`/api/endpoints/${endpointId}`, { method: "DELETE" });
      router.push("/dashboard");
      router.refresh();
    } catch {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm">
        Are you sure you want to delete <strong>{endpointName}</strong>? This
        will also delete all check history.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-white"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="rounded-xl bg-red-600 px-3 py-2 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
