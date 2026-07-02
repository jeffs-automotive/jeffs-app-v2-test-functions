"use client";

/**
 * TemplatesEditor — the cell editor dialog for a single
 * (scope × kind × channel) customer message template.
 *
 * SPIN NOTE: runs setMessageTemplateAction IMPERATIVELY with a plain
 * `saving` flag (NOT useActionState) — same rationale as AssignKeytagForm:
 * useActionState pins the pending state to the post-action RSC re-render,
 * which re-suspends the sibling tabs on the force-dynamic /schedulerconfig
 * page. Imperative await resolves on the action RETURN + we call
 * router.refresh() ourselves.
 *
 * Client mirrors the server's SMS hard-stop (>3 segments) + unknown-token
 * rejection so the user gets inline feedback before submitting — the action
 * is still the authority (fail-closed).
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  MERGE_FIELD_SAMPLES,
  estimateSmsSegments,
  renderTemplate,
} from "@/lib/scheduler/template-renderer";
import { setMessageTemplateAction } from "@/actions/scheduler/direct-config-actions";
import type { MessageTemplateRow } from "@/lib/scheduler/read-dal";

const KIND_LABEL: Record<MessageTemplateRow["kind"], string> = {
  confirmation: "Confirmation",
  reminder_24h: "24-hour reminder",
  reminder_2h: "2-hour reminder",
};

const MERGE_TOKENS = Object.keys(MERGE_FIELD_SAMPLES);

export interface TemplatesEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = shop default scope. */
  typeId: string | null;
  scopeLabel: string;
  kind: MessageTemplateRow["kind"];
  channel: MessageTemplateRow["channel"];
  /**
   * The template resolved AT THIS scope, or null when this cell currently
   * inherits (no own row). When inheriting we seed the editor from the
   * default so saving creates an override rather than starting blank.
   */
  ownRow: MessageTemplateRow | null;
  inheritedRow: MessageTemplateRow | null;
}

export function TemplatesEditor({
  open,
  onOpenChange,
  typeId,
  scopeLabel,
  kind,
  channel,
  ownRow,
  inheritedRow,
}: TemplatesEditorProps) {
  const router = useRouter();
  const seed = ownRow ?? inheritedRow;
  const isEmail = channel === "email";
  const isOverride = ownRow === null && typeId !== null;

  const [subject, setSubject] = useState<string>(seed?.subject ?? "");
  const [body, setBody] = useState<string>(seed?.body ?? "");
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const insertToken = useCallback((token: string) => {
    const el = bodyRef.current;
    const snippet = `{{${token}}}`;
    if (!el) {
      setBody((b) => b + snippet);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setBody((b) => b.slice(0, start) + snippet + b.slice(end));
    // Restore caret after the inserted token on next paint.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  }, []);

  const preview = renderTemplate(body, "sample");
  const seg = preview.ok && channel === "sms" ? estimateSmsSegments(preview.text) : null;
  const smsHardStop = seg !== null && seg.segments > 3;

  const run = useCallback(async () => {
    setSaving(true);
    try {
      const result = await setMessageTemplateAction({
        type_id: typeId,
        kind,
        channel,
        subject: isEmail ? subject : null,
        body,
        expected_updated_at: ownRow?.updated_at,
      });
      if (result.status === "success") {
        toast.success(`Saved ${KIND_LABEL[kind]} · ${channel.toUpperCase()}`, {
          description: `${scopeLabel} scope updated.`,
        });
        onOpenChange(false);
        router.refresh();
      } else if (result.status === "stale") {
        toast.error("Template changed since you loaded it", { description: result.error });
        onOpenChange(false);
        router.refresh();
      } else if (result.status === "validation_error" || result.status === "error") {
        toast.error("Couldn't save template", { description: result.error });
      }
    } catch (e) {
      toast.error("Couldn't save template", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [
    typeId,
    kind,
    channel,
    isEmail,
    subject,
    body,
    ownRow,
    scopeLabel,
    onOpenChange,
    router,
  ]);

  const canSave =
    body.trim().length >= 10 &&
    (!isEmail || subject.trim().length > 0) &&
    preview.ok &&
    !smsHardStop &&
    !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {KIND_LABEL[kind]} · {channel.toUpperCase()}
          </DialogTitle>
          <DialogDescription>
            Scope: <strong>{scopeLabel}</strong>
            {isOverride && (
              <>
                {" "}
                — currently inherits the shop default. Saving creates an
                override for this appointment type.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isEmail && (
            <div className="space-y-1">
              <Label htmlFor="tpl-subject" className="text-xs uppercase tracking-wider text-muted-foreground">
                Subject line
              </Label>
              <Input
                id="tpl-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
                placeholder="Your appointment is confirmed"
                disabled={saving}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="tpl-body" className="text-xs uppercase tracking-wider text-muted-foreground">
              Message body
            </Label>
            <textarea
              id="tpl-body"
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={4000}
              disabled={saving}
              className="flex w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
              placeholder={
                channel === "sms"
                  ? "Hi {{first_name}}, this is Jeff's Automotive confirming your appointment on {{appointment_date}}{{appointment_time_suffix}}."
                  : "Hi {{first_name}},\n\nYour appointment is confirmed for {{appointment_date}}{{appointment_time_suffix}}."
              }
            />
          </div>

          {/* Merge-field helper row */}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Merge fields (click to insert)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MERGE_TOKENS.map((token) => (
                <Button
                  key={token}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => insertToken(token)}
                  disabled={saving}
                  className="font-mono"
                  title={`Sample: ${MERGE_FIELD_SAMPLES[token]}`}
                >
                  {`{{${token}}}`}
                </Button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Live preview (sample data)
              </p>
              {channel === "sms" && seg && (
                <Badge
                  variant={
                    smsHardStop ? "destructive" : seg.segments > 1 ? "secondary" : "outline"
                  }
                >
                  {seg.chars} chars · {seg.segments} segment
                  {seg.segments === 1 ? "" : "s"} · {seg.encoding}
                </Badge>
              )}
            </div>
            {preview.ok ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                {isEmail && subject.trim() && (
                  <p className="mb-1 font-medium">
                    {renderTemplate(subject, "sample").ok
                      ? (renderTemplate(subject, "sample") as { ok: true; text: string }).text
                      : subject}
                  </p>
                )}
                <p className={cn("whitespace-pre-wrap", !body.trim() && "text-muted-foreground")}>
                  {body.trim() ? preview.text : "Nothing to preview yet."}
                </p>
              </div>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                Unknown merge field
                {preview.unknown_tokens.length === 1 ? "" : "s"}:{" "}
                <span className="font-mono">
                  {preview.unknown_tokens.map((t) => `{{${t}}}`).join(", ")}
                </span>
                . Remove or fix before saving.
              </p>
            )}
            {smsHardStop && (
              <p className="text-xs text-destructive">
                Over 3 SMS segments — trim the message before saving.
              </p>
            )}
            {channel === "sms" && seg && seg.segments > 1 && !smsHardStop && (
              <p className="text-xs text-muted-foreground">
                Sends as {seg.segments} segments — customers may see it as multiple texts.
              </p>
            )}
          </div>
        </div>

        <DialogFooter showCloseButton>
          <Button type="button" onClick={() => void run()} loading={saving} loadingText="Saving…" disabled={!canSave}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
