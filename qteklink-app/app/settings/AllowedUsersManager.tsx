"use client";

/**
 * "Who can sign in" manager (admin-only) — add a Microsoft account by email,
 * flip Viewer/Admin, deactivate/reactivate, and remove a row that never signed
 * in. Sensitive flips confirm first; the server blocks anything that would
 * lock the shop out (you can't deactivate or demote the only active admin).
 */
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import {
  addAllowedUserAction,
  setAllowedUserActiveAction,
  setAllowedUserRoleAction,
  removeAllowedUserAction,
} from "@/actions/allowed-users";
import type { AllowedUserView } from "@/lib/dal/allowed-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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

/**
 * One queued confirmation: the dialog copy (title/body carry the SAME information
 * window.confirm previously showed) + variant + the exact dispatch the confirmed
 * window.confirm branch ran. Closing/confirming routes through setConfirm(null).
 */
type PendingConfirm = {
  title: string;
  body: string;
  confirmLabel: string;
  confirmingLabel: string;
  variant: "default" | "destructive";
  run: () => void;
};

function RowActions({ user, selfEmail }: { user: AllowedUserView; selfEmail: string }) {
  const [activeState, activeAction, activePending] = useActionState(setAllowedUserActiveAction, null);
  const [roleState, roleAction, rolePending] = useActionState(setAllowedUserRoleAction, null);
  const [removeState, removeAction, removePending] = useActionState(removeAllowedUserAction, null);
  const [, start] = useTransition();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  useRefreshOnOk(activeState);
  useRefreshOnOk(roleState);
  useRefreshOnOk(removeState);

  const isSelf = user.email === selfEmail.toLowerCase();
  const pending = activePending || rolePending || removePending;

  // Same dispatches the window.confirm branches ran — only the confirm UI changed.
  // The body text is verbatim what window.confirm showed below the question line.
  function flipActive() {
    const turningOff = user.active;
    const fd = new FormData();
    fd.set("id", user.id);
    fd.set("active", String(!user.active));
    setConfirm({
      title: turningOff ? `Turn OFF access for ${user.email}?` : `Turn access back ON for ${user.email}?`,
      body: turningOff
        ? "They won't be able to open QTekLink until you turn them back on." +
          (isSelf ? "\n\n⚠ This is YOUR account — you'd be locked out too." : "")
        : "",
      confirmLabel: turningOff ? "Turn off access" : "Turn access back on",
      confirmingLabel: "Working…",
      variant: "default",
      run: () => start(() => activeAction(fd)),
    });
  }

  function flipRole() {
    const toAdmin = user.role !== "admin";
    const fd = new FormData();
    fd.set("id", user.id);
    fd.set("role", toAdmin ? "admin" : "viewer");
    setConfirm({
      title: toAdmin ? `Make ${user.email} an ADMIN?` : `Change ${user.email} to VIEWER?`,
      body: toAdmin
        ? "Admins can post days to QuickBooks and change every setting (including this list)."
        : "They'll still see everything but can't post or change settings." +
          (isSelf ? "\n\n⚠ This is YOUR account — you'd lose admin access." : ""),
      confirmLabel: toAdmin ? "Make Admin" : "Change to Viewer",
      confirmingLabel: "Working…",
      variant: "default",
      run: () => start(() => roleAction(fd)),
    });
  }

  function remove() {
    const fd = new FormData();
    fd.set("id", user.id);
    setConfirm({
      title: `Remove ${user.email} from the list?`,
      body: "They never signed in, so nothing else is affected.",
      confirmLabel: "Remove",
      confirmingLabel: "Removing…",
      variant: "destructive",
      run: () => start(() => removeAction(fd)),
    });
  }

  // Confirm: close the dialog, then dispatch — mirrors the old "window.confirm
  // returns true → run" sequence (any error surfaces inline on the row below).
  function onConfirm() {
    const c = confirm;
    setConfirm(null);
    c?.run();
  }

  const err = [activeState, roleState, removeState].find((s) => s && s.ok === false) as
    | { ok: false; message: string }
    | undefined;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={flipRole} disabled={pending}>
        {user.role === "admin" ? "Change to Viewer" : "Make Admin"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={flipActive}
        disabled={pending}
        className={user.active ? "border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40" : "border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"}
      >
        {user.active ? "Turn off access" : "Turn access back on"}
      </Button>
      {!user.bound && (
        <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      )}
      {err && <span className="text-xs text-red-700 dark:text-red-400">{err.message}</span>}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => { if (!next) setConfirm(null); }}
        isPending={pending}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        confirmingLabel={confirm?.confirmingLabel ?? "Working…"}
        variant={confirm?.variant ?? "default"}
        onConfirm={onConfirm}
      />
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
          <li key={u.id} className={`rounded-lg border border-border p-3 shadow-xs ${u.active ? "bg-card" : "bg-muted"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{u.email}</span>
              {u.fullName && <span className="text-sm text-muted-foreground">({u.fullName})</span>}
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{ROLE_LABEL[u.role] ?? u.role}</Badge>
              {!u.active && <Badge variant="secondary">access off</Badge>}
              {!u.bound && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">hasn&apos;t signed in yet</Badge>}
            </div>
            <RowActions user={u} selfEmail={selfEmail} />
          </li>
        ))}
      </ul>

      <form ref={formRef} action={addAction} className="mt-5 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-medium text-foreground">Add someone</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Enter their work Microsoft email. They appear as &quot;hasn&apos;t signed in yet&quot; until
          their first sign-in links their Microsoft account automatically.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            name="email"
            type="email"
            required
            placeholder="person@jeffsautomotive.com"
            className="w-64"
          />
          <select name="role" defaultValue="viewer" className="rounded-md border border-input bg-card px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin (can post + change settings)</option>
          </select>
          <Button type="submit" loading={addPending} loadingText="Adding…">
            <UserPlus aria-hidden="true" />
            Add to the list
          </Button>
        </div>
        {addState?.ok && <p className="mt-2 text-sm text-emerald-800 dark:text-emerald-300">Added.</p>}
        {addState?.ok === false && <p className="mt-2 text-sm text-red-700 dark:text-red-400">{addState.message}</p>}
      </form>
    </div>
  );
}
