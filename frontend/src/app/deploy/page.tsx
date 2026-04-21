import { DeployView } from "@/components/deploy-view";

export const metadata = {
  title: "Submit Deployment — Pulse",
};

export default function PublicDeployPage() {
  return (
    <div className="dot-grid min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <DeployView />
      </div>
    </div>
  );
}
