"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { EndpointForm } from "@/components/endpoint-form";
import { DashboardHeader } from "@/components/dashboard-header";

export default function EditEndpointPage() {
  const { id } = useParams<{ id: string }>();
  const { data: endpoint } = useSWR(`/api/endpoints/${id}`);

  if (!endpoint) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-96 animate-pulse rounded-2xl border bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title={`Edit: ${endpoint.name}`} />
      <EndpointForm mode="edit" endpointId={id} initialData={endpoint} />
    </div>
  );
}
