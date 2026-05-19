"use client";

import { useState, useTransition } from "react";

import {
  inviteUser,
  removeUser,
  updateUserRole,
  type UserRole,
} from "@/app/(app)/users/actions";

export interface ManagedUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  createdAt: string | null;
  lastSignInAt: string | null;
}

interface UsersManagerProps {
  users: ManagedUser[];
  /** Signed-in admin's id — used to disable destructive actions on self. */
  currentUserId: string;
}

export function UsersManager({ users, currentUserId }: UsersManagerProps) {
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runAction(
    label: string,
    op: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setError(null);
    setToast(null);
    startTransition(async () => {
      const r = await op();
      if (r.ok) {
        setToast(label);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <section className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {toast && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-md border border-green-200 bg-green-soft px-3 py-2 text-sm text-green-800"
        >
          <span>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-green-700 hover:bg-green-soft/60"
          >
            ✕
          </button>
        </div>
      )}

      <InviteForm
        pending={pending}
        onInvite={(payload) =>
          runAction(`Invite sent to ${payload.email}.`, () =>
            inviteUser(payload),
          )
        }
      />

      <div className="rounded-lg border border-gray-100 bg-white">
        <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 text-sm text-gray-500">
          <span>
            <span className="font-display text-base font-semibold text-navy-deep">
              {users.length}
            </span>{" "}
            user{users.length === 1 ? "" : "s"}
            {" · "}
            <span className="text-navy-deep">
              {users.filter((u) => u.role === "admin").length} admin
              {users.filter((u) => u.role === "admin").length === 1 ? "" : "s"}
            </span>
          </span>
        </header>

        {users.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            No users yet. Invite the first one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-display font-semibold">Email</th>
                  <th className="px-6 py-3 font-display font-semibold">Name</th>
                  <th className="px-6 py-3 font-display font-semibold">Role</th>
                  <th className="px-6 py-3 font-display font-semibold whitespace-nowrap">
                    Last sign-in
                  </th>
                  <th className="px-6 py-3 font-display font-semibold text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => {
                  const isSelf = u.id === currentUserId;
                  return (
                    <tr key={u.id} className="hover:bg-off-white">
                      <td className="px-6 py-3">
                        <span className="font-mono text-[13px] text-gray-800">
                          {u.email}
                        </span>
                        {isSelf && (
                          <span className="ml-2 rounded-full bg-navy-soft px-1.5 py-0.5 font-display text-[9px] font-semibold uppercase tracking-wider text-navy-deep">
                            You
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-gray-700">
                        {u.name ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={u.role}
                          disabled={pending || isSelf}
                          onChange={(e) =>
                            runAction(`Role updated for ${u.email}.`, () =>
                              updateUserRole({
                                userId: u.id,
                                role: e.target.value as UserRole,
                              }),
                            )
                          }
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="reviewer">reviewer</option>
                          <option value="admin">admin</option>
                        </select>
                        {isSelf && (
                          <span className="ml-2 text-[11px] text-gray-400">
                            (ask another admin to demote)
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">
                        {u.lastSignInAt
                          ? new Date(u.lastSignInAt).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "never"}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          type="button"
                          disabled={pending || isSelf}
                          onClick={() => {
                            if (
                              !confirm(
                                `Remove ${u.email}? They lose access immediately.`,
                              )
                            )
                              return;
                            runAction(`Removed ${u.email}.`, () =>
                              removeUser(u.id),
                            );
                          }}
                          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-soft disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function InviteForm({
  pending,
  onInvite,
}: {
  pending: boolean;
  onInvite: (payload: { email: string; role: UserRole }) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("reviewer");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || pending) return;
    onInvite({ email, role });
    setEmail("");
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 bg-white p-4"
    >
      <div className="flex-1 min-w-[240px]">
        <label
          htmlFor="invite-email"
          className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
        >
          Email <span className="text-red-600">*</span>
        </label>
        <input
          id="invite-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="surya.l@edstellar.com"
          className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
      </div>

      <div className="min-w-[160px]">
        <label
          htmlFor="invite-role"
          className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
        >
          Role
        </label>
        <select
          id="invite-role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        >
          <option value="reviewer">reviewer</option>
          <option value="admin">admin</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Working…" : "Send invite"}
      </button>
      <p className="basis-full text-[11px] text-gray-500">
        Sends a magic-link sign-in email through Supabase Auth and stamps the
        selected role so the user lands in the dashboard on first click.
      </p>
    </form>
  );
}
