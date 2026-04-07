import { useProjectFilter } from "@/components/project-context";

export function useFilteredKey(baseUrl: string): string {
  const { projectId } = useProjectFilter();
  if (!projectId) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}projectId=${projectId}`;
}
