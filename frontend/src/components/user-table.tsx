"use client";

import useSWR from "swr";
import { Trash2, Check, X, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface UserRow {
  _id: string;
  email: string;
  role: string;
  status?: string;
  approvedBy?: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-400",
    pending:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-400",
    rejected: "bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium capitalize ${
        styles[status] ?? styles.approved
      }`}
    >
      {status}
    </span>
  );
}

export function UserTable() {
  const { data: users, mutate } = useSWR<UserRow[]>("/api/users");

  async function handleRoleChange(id: string, role: string) {
    await apiFetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    mutate();
  }

  async function handleApprove(id: string) {
    await apiFetch(`/api/users/${id}/approve`, { method: "POST" });
    mutate();
  }

  async function handleReject(id: string, email: string) {
    if (
      !confirm(
        `Reject ${email}? They will not be able to log in. The email stays claimed so it cannot re-register.`
      )
    )
      return;
    await apiFetch(`/api/users/${id}/reject`, { method: "POST" });
    mutate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this user?")) return;
    await apiFetch(`/api/users/${id}`, { method: "DELETE" });
    mutate();
  }

  if (!users) {
    return <div className="h-32 animate-pulse rounded-2xl border bg-muted" />;
  }

  const pending = users.filter((u) => (u.status ?? "approved") === "pending");

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <Clock className="h-4 w-4" />
            {pending.length} registration{pending.length > 1 ? "s" : ""} awaiting
            approval
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => {
              const status = user.status ?? "approved";
              return (
                <tr
                  key={user._id}
                  className={`transition-colors hover:bg-muted/50 ${
                    status === "pending" ? "bg-amber-50/40 dark:bg-amber-900/5" : ""
                  }`}
                >
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user._id, e.target.value)}
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
                    <div className="flex items-center gap-1.5">
                      {status === "pending" && (
                        <>
                          <button
                            onClick={() => handleApprove(user._id)}
                            title="Approve registration"
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(user._id, user.email)}
                            title="Reject registration"
                            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </>
                      )}
                      {status === "rejected" && (
                        <button
                          onClick={() => handleApprove(user._id)}
                          title="Approve after all"
                          className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(user._id)}
                        title="Delete user"
                        className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
