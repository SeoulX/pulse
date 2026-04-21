"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Rocket } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/components/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isRegistering) {
        await register(email, password);
      }

      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mesh-gradient flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 via-background to-amber-50/30 dark:from-[#0c2d3f]/50 dark:via-background dark:to-[#164e63]/20">
      <div className="mesh-blob" />
      <div className="absolute right-6 top-6 z-10">
        <ThemeToggle />
      </div>
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-2xl border bg-card p-8 shadow-lg">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a1a1a] shadow-md dark:bg-[#164e63]">
            <Activity className="h-7 w-7 text-[#f0a830] dark:text-[#5ab4c5]" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Pulse</h1>
          <p className="text-sm text-muted-foreground">API Health Monitor</p>
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
              placeholder="admin@company.com"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
              minLength={isRegistering ? 8 : 1}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] disabled:opacity-50 dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
          >
            {loading
              ? "Loading..."
              : isRegistering
                ? "Create Account"
                : "Log In"}
          </button>
        </form>

        <button
          onClick={() => setIsRegistering(!isRegistering)}
          className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-[#e8871e] dark:hover:text-[#5ab4c5]"
        >
          {isRegistering
            ? "Already have an account? Log in"
            : "First time? Create an account"}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Link
          href="/deploy"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#e8871e] bg-[#e8871e]/10 px-4 py-2.5 text-sm font-medium text-[#e8871e] transition-colors hover:bg-[#e8871e]/20 dark:border-[#2a7f9e] dark:bg-[#2a7f9e]/10 dark:text-[#5ab4c5] dark:hover:bg-[#2a7f9e]/20"
        >
          <Rocket className="h-4 w-4" />
          Request Deployment
        </Link>
        <p className="text-center text-xs text-muted-foreground">
          No account needed — devs can submit deployment requests directly.
        </p>
      </div>
    </div>
  );
}
