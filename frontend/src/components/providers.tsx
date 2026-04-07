"use client";

import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { fetcher } from "@/lib/swr/fetcher";
import { AuthProvider } from "@/components/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <AuthProvider>
        <SWRConfig value={{ fetcher, refreshInterval: 10000 }}>
          {children}
        </SWRConfig>
      </AuthProvider>
    </ThemeProvider>
  );
}
