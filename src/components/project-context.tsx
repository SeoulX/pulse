"use client";

import { createContext, useContext, useState } from "react";

interface ProjectFilterContextValue {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
}

const ProjectFilterContext = createContext<ProjectFilterContextValue>({
  projectId: null,
  setProjectId: () => {},
});

export function ProjectFilterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);

  return (
    <ProjectFilterContext.Provider value={{ projectId, setProjectId }}>
      {children}
    </ProjectFilterContext.Provider>
  );
}

export function useProjectFilter() {
  return useContext(ProjectFilterContext);
}
