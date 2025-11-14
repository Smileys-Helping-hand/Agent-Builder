"use client";

import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import HeroSection from "../ui/HeroSection";
import heroImages from "../../theme/heroImages";
import {
  fetchAdminUsers,
  fetchAuditLog,
  inviteUserAccount,
  type AdminUserRecord,
  type AuditLogEntry
} from "../../lib/api";

const roles: Array<{ id: string; label: string }> = [
  { id: "owner", label: "Owner" },
  { id: "admin", label: "Admin" },
  { id: "developer", label: "Developer" },
  { id: "viewer", label: "Viewer" }
];

type UserManagementProps = {
  canManage: boolean;
};

export const UserManagementPanel = ({ canManage }: UserManagementProps) => {
  const { data, mutate } = useSWR<{ users: AdminUserRecord[] } | null>(
    canManage ? "admin-users" : null,
    fetchAdminUsers,
    { revalidateOnFocus: false }
  );
  const { data: auditLog } = useSWR<{ entries: AuditLogEntry[] } | null>(
    canManage ? ["admin-audit-log", 10] : null,
    () => fetchAuditLog({ limit: 10, eventType: "auth.login" }),
    { revalidateOnFocus: false }
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sortedUsers = useMemo(() => {
    return (data?.users ?? []).slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [data?.users]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setTemporaryPassword(null);

    try {
      const response = await inviteUserAccount({ email: email.trim(), role });
      await mutate();
      setTemporaryPassword(response.temporaryPassword);
      setEmail("");
      setRole("viewer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite user.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto mt-10 max-w-5xl space-y-6 px-6">
      <HeroSection
        image={heroImages.build}
        title="User Management"
        subtitle="Invite teammates and assign roles"
      />

      {!canManage && (
        <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
          Only administrators can invite new users or adjust access levels.
        </p>
      )}

      {canManage && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-black/30">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Invite new member</h3>
            <form onSubmit={onSubmit} className="space-y-3">
              <label className="block text-sm text-slate-300">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="builder@hustlestudio.ai"
                  required
                />
              </label>
              <label className="block text-sm text-slate-300">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Role</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                >
                  {roles.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {error && <p className="text-sm text-rose-400">{error}</p>}
              {temporaryPassword && (
                <p className="text-sm text-emerald-400">
                  Temporary password: <span className="font-mono">{temporaryPassword}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {saving ? "Inviting..." : "Send Invite"}
              </button>
            </form>
          </div>

          <div className="space-y-3">
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Current Users</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                {sortedUsers.map((user) => (
                  <li key={user.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="font-semibold text-slate-100">{user.email}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{user.role}</p>
                    <p className="text-[11px] text-slate-500">
                      Status: {user.status ?? "active"}
                      {user.lastLoginAt && (
                        <>
                          {" "}· Last login {new Date(user.lastLoginAt).toLocaleString()}
                        </>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">Joined {new Date(user.createdAt).toLocaleString()}</p>
                  </li>
                ))}
                {sortedUsers.length === 0 && <li className="text-xs text-slate-500">No users registered yet.</li>}
              </ul>
            </div>

            {auditLog && (
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent Sign-ins</h3>
                <ul className="space-y-2 text-xs text-slate-300">
                  {(auditLog.entries ?? []).map((entry) => (
                    <li key={entry.id} className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <span className="font-medium text-slate-100">{entry.actorEmail ?? "Unknown"}</span>
                      <span className="text-[11px] uppercase tracking-wide text-emerald-400">Successful login</span>
                      <span className="text-[11px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                  {(auditLog.entries ?? []).length === 0 && (
                    <li className="text-[11px] text-slate-500">No recent logins recorded.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default UserManagementPanel;
