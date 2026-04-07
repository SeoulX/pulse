"use client";

import useSWR from "swr";
import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export function UserTable() {
  const { data: users, mutate } = useSWR("/api/users");

  async function handleRoleChange(id: string, role: string) {
    await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    mutate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    mutate();
  }

  if (!users) {
    return (
      <div className="h-32 animate-pulse rounded-2xl border bg-muted" />
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Email</th>
            <th className="px-4 py-3 text-left font-medium">Role</th>
            <th className="px-4 py-3 text-left font-medium">Created</th>
            <th className="px-4 py-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {users.map(
            (user: {
              _id: string;
              email: string;
              role: string;
              createdAt: string;
            }) => (
              <tr
                key={user._id}
                className="transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    onChange={(e) =>
                      handleRoleChange(user._id, e.target.value)
                    }
                    className="rounded-lg border bg-background px-2 py-1 text-sm outline-none focus:border-[#e8871e] dark:focus:border-[#2a7f9e]"
                  >
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(user._id)}
                    className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
