"use client";

/**
 * SettingsForm — back-office alert recipients + stale threshold (admin-only; the action
 * re-checks). Comma-separated recipient inputs grouped into designed cards. Prefilled from
 * the current settings; saves via updateBackOfficeSettingsAction. The field `name`s and the
 * comma-list submission model are unchanged — this is a presentational grouping only.
 */
import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateBackOfficeSettingsAction } from "@/actions/back-office/settings";
import type { BackOfficeSettings } from "@/lib/dal/back-office";

function ListField({ name, label, help, initial }: { name: string; label: string; help: string; initial: string[] }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground">{help}</span>
      <Input name={name} defaultValue={initial.join(", ")} className="mt-1" placeholder="a@shop.com, b@shop.com" />
    </label>
  );
}

export function SettingsForm({ settings, canEdit }: { settings: BackOfficeSettings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateBackOfficeSettingsAction, null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state?.timestamp, state?.ok]);

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Back-office alerts</CardTitle>
          <CardDescription>Only an admin can change these.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Service advisors</dt><dd>{settings.saEmails.join(", ") || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Office</dt><dd>{settings.officeEmails.join(", ") || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Accounting</dt><dd>{settings.accountingEmails.join(", ") || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Daily digest</dt><dd>{settings.digestEmails.join(", ") || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Admin fallback</dt><dd>{settings.fallbackAdminEmail || "—"}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Stale after</dt><dd className="tabular-nums">{settings.staleHours} hours</dd></div>
          </dl>
        </CardContent>
      </Card>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Alert recipients</CardTitle>
          <CardDescription>Comma-separate multiple addresses. Each list controls a different alert.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ListField name="sa_emails" label="Service-advisor recipients" help="Get 'sent to SA' alerts." initial={settings.saEmails} />
          <ListField name="office_emails" label="Office recipients" help="Get fix-submitted, RO-closed, and verified alerts." initial={settings.officeEmails} />
          <ListField name="accounting_emails" label="Accounting recipients" help="Get detected + fix-submitted + verified alerts." initial={settings.accountingEmails} />
          <ListField name="digest_emails" label="Daily-digest recipients" help="Get the once-a-day open + stale summary." initial={settings.digestEmails} />
          <label className="block">
            <span className="text-sm font-medium text-foreground">Admin fallback address</span>
            <span className="block text-xs text-muted-foreground">The &quot;send to admin&quot; button uses this when an invoice can&apos;t be found.</span>
            <Input name="fallback_admin_email" defaultValue={settings.fallbackAdminEmail} className="mt-1" placeholder="admin@shop.com" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stale threshold</CardTitle>
          <CardDescription>How long an issue can sit idle before it&apos;s flagged for review.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="block max-w-40">
            <span className="text-sm font-medium text-foreground">Stale after (hours)</span>
            <span className="block text-xs text-muted-foreground">48 = 2 days.</span>
            <Input name="stale_hours" type="number" min={1} max={720} defaultValue={settings.staleHours} className="mt-1 tabular-nums" />
          </label>
        </CardContent>
      </Card>

      {state?.ok === false && <p className="text-xs text-red-700 dark:text-red-400">{state.message}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} loadingText="Saving…">
          <Save aria-hidden="true" />
          Save settings
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}
