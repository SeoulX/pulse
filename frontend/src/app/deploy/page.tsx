import { DeploymentForm } from "@/components/deployment-form";
import { DeploymentRepoBrowser } from "@/components/deployment-repo-browser";

export default function PublicDeployPage() {
  return (
    <>
      <DeploymentForm />
      <DeploymentRepoBrowser />
    </>
  );
}
