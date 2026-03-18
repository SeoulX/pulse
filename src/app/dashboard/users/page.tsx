"use client";

import { useState } from "react";
import { UserTable } from "@/components/user-table";
import { useSWRConfig } from "swr";
import { DashboardHeader } from "@/components/dashboard-header";

export default function UsersPage() {
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { mutate } = useSWRConfig();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      setEmail("");
      setPassword("");
      setShowForm(false);
      mutate("/api/users");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="Users" />

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-xl bg-[#1a1a1a] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f]"
        >
          + Create User
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="max-w-md space-y-3 rounded-2xl border bg-card p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border bg-background px-4 py-2.5 text-sm outline-none transition-all focus:border-[#e8871e] focus:ring-2 focus:ring-[#e8871e]/20 dark:focus:border-[#2a7f9e] dark:focus:ring-[#2a7f9e]/20"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border px-4 py-2 text-sm transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm text-white transition-colors hover:bg-[#2d1b0e] dark:bg-[#164e63] dark:hover:bg-[#0c2d3f] disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      )}

      <UserTable />
    </div>
  );
}
