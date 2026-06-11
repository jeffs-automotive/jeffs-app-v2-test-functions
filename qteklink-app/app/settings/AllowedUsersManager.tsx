"use client";

/**
 * "Who can sign in" manager (admin-only) — add a Microsoft account by email,
 * flip Viewer/Admin, deactivate/reactivate, and remove a row that never signed
 * in. Sensitive flips confirm first; the server blocks anything that would
 * lock the shop out (you can't deactivate or demote the only active admin).
 */
import { useActionState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addAllowedUserAction,
  setAllowedUserActiveAction,
  setAllowedUserRoleAction,
  removeAllowedUserAction,
} from "@/actions/allowed-users";
import type { AllowedUserView } from "@/lib/dal/allowed-users";

const btn = "rounded px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

const ROLE_LABEL: Record<string, string> = {
  viewer: "Viewer (read-only)",
  approver: "Approver",
  admin: "Admin (can post + change settings)",
};

function useRefreshOnOk(state: { ok: boolean; timestamp: number } | null) {
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);
}

function RowActions({ user, selfEmail }: { user: AllowedUserView; selfEmail: string }) {
  const [activeState, activeAction, activePending] = useActionState(setAllowedUserActiveAction, null);
  const [roleState, roleAction, rolePending] = useActionState(setAllowedUserRoleAction, null);
  const [removeState, removeAction, removePending] = useActionState(removeAllowedUserAction, null);
  const [, start] = useTransition();
  useRefreshOnOk(activeState);
  useRefreshOnOk(roleState);
  useRefreshOnOk(removeState);

  const isSelf = user.email === selfEmail.toLowerCase();
  const pending = activePending || rolePending || removePending;

  function flipActive() {
    const turningOff = user.active;
    const msg = turningOff
      ? `Turn OFF access for ${user.email}?\n\nThey won't be able to open QTekLink until you turn them back on.` +
        (isSelf ? "\n\n⚠ This is YOUR account — you'd be locked out too." : "")
      : `Turn access back ON for ${user.email}?`;
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", user.id);
    fd.set("active", String(!user.active));
    start(() => activeAction(fd));
  }

  function flipRole() {
    const toAdmin = user.role !== "admin";
    const msg = toAdmin
      ? `Make ${user.email} an ADMIN?\n\nAdmins can post days to QuickBooks and change every setting (including this list).`
      : `Change ${user.email} to VIEWER?\n\nThey'll still see everything but can't post or change settings.` +
        (isSelf ? "\n\n⚠ This is YOUR account — you'd lose admin access." : "");
    if (!window.confirm(msg)) return;
    const fd = new FormData();
    fd.set("id", user.id);
    fd.set("role", toAdmin ? "admin" : "viewer");
    start(() => roleAction(fd));
  }

  function remove() {
    if (!window.confirm(`Remove ${user.email} from the list?\n\nThey never signed in, so nothing else is affected.`)) return;
    const fd = new FormData();
    fd.set("id", user.id);
    start(() => removeAction(fd));
  }

  const err = [activeState, roleState, removeState].find((s) => s && s.ok === false) as
    | { ok: false; message: string }
    | undefined;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button onClick={flipRole} disabled={pending} className={`${btn} border border-stone-300 text-stone-700 hover:bg-stone-50`}>
        {user.role === "admin" ? "Change to Viewer" : "Make Admin"}
      </button>
      <button onClick={flipActive} disabled={pending} className={`${btn} border ${user.active ? "border-amber-300 text-amber-800 hover:bg-amber-50" : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"}`}>
        {user.active ? "Turn off access" : "Turn access back on"}
      </button>
      {!user.bound && (
        <button onClick={remove} disabled={pending} className={`${btn} border border-red-200 text-red-700 hover:bg-red-50`}>
          Remove
        </button>
      )}
      {err && <span className="text-xs text-red-700">{err.message}</span>}
    </div>
  );
}

export default function AllowedUsersManager({ users, selfEmail }: { users: AllowedUserView[]; selfEmail: string }) {
  const [addState, addAction, addPending] = useActionState(addAllowedUserAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  useRefreshOnOk(addState);
  useEffect(() => {
    if (addState?.ok) formRef.current?.reset();
  }, [addState?.timestamp, addState?.ok]);

  return (
    <div>
      <ul className="mt-4 space-y-3">
        {users.map((u) => (
          <li key={u.id} className={`rounded-lg border p-3 ${u.active ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-100"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-stone-900">{u.email}</span>
              {u.fullName && <span className="text-sm text-stone-500">({u.fullName})</span>}
              <span className="rounded bg-[#96003C]/10 px-2 py-0.5 text-xs font-medium text-[#96003C]">{ROLE_LABEL[u.role] ?? u.role}</span>
              {!u.active && <span className="rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600">access off</span>}
              {!u.bound && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">hasn&apos;t signed in yet</span>}
            </div>
            <RowActions user={u} selfEmail={selfEmail} />
          </li>
        ))}
      </ul>

      <form ref={formRef} action={addAction} className="mt-5 rounded-lg border border-dashed border-stone-300 p-4">
        <p className="text-sm font-medium text-stone-900">Add someone</p>
        <p className="mt-0.5 text-xs text-stone-500">
          Enter their work Microsoft email. They appear as &quot;hasn&apos;t signed in yet&quot; until
          their first sign-in links their Microsoft account automatically.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="person@jeffsautomotive.com"
            className="w-64 rounded border border-stone-300 px-2 py-1.5 text-sm"
          />
          <select name="role" defaultValue="viewer" className="rounded border border-stone-300 px-2 py-1.5 text-sm">
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin (can post + change settings)</option>
          </select>
          <button type="submit" disabled={addPending}
            className="rounded bg-[#96003C] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60">
            {addPending ? "Adding…" : "Add to the list"}
          </button>
        </div>
        {addState?.ok && <p className="mt-2 text-sm text-green-700">Added.</p>}
        {addState?.ok === false && <p className="mt-2 text-sm text-red-700">{addState.message}</p>}
      </form>
    </div>
  );
}
