import { AddWorkerForm } from "@/components/add-worker-form";

export default function AddWorkerPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Add worker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append a new worker to an existing scraper&rsquo;s{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">devops/workers.yml</code>.
          Pulse commits the file, bumps an alpha tag, and Jenkins regenerates the manifest.
          Staging-only on apply (MVP).
        </p>
      </header>
      <AddWorkerForm />
    </div>
  );
}
