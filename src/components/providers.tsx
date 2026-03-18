"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";
import { fetcher } from "@/lib/swr/fetcher";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <SessionProvider>
        <SWRConfig value={{ fetcher, refreshInterval: 10000 }}>
          {children}
        </SWRConfig>
      </SessionProvider>
    </ThemeProvider>
  );
}
