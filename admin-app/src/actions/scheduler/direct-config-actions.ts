"use server";

/**
 * Direct webform actions — capacity, appointment types, message templates,
 * ops (sub-feature A + C, 2026-07-02). Same thin-wrapper contract as
 * direct-catalog-actions.ts.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import {
  type DirectFormState,
  stateFromResult,
  validationError,
} from "@/lib/scheduler/direct-form-state";
import {
  addClosedDate,
  blockCapacity,
  deactivateAppointmentType,
  removeClosedDate,
  resetCardText,
  runAppointmentsSyncDirect,
  setAppointmentLimits,
  setAppointmentType,
  setCardText,
  setMessageTemplate,
  unblockCapacity,
} from "@/lib/scheduler/write-dal";
import { getCardTextSlot } from "@/lib/scheduler/read-dal";
import { renderTemplate, validateSmsTemplateBody } from "@/lib/scheduler/template-renderer";
import { validateCardTextBody } from "@/lib/scheduler/card-merge-fields";

const CONFIG_PATH = "/schedulerconfig";

/**
 * Like `wrapAdminAction`, but for the direct-config actions that all return
 * `DirectFormState`: wraps the body in a top-level try/catch so a THROWN
 * exception (e.g. requireAdmin auth failure, or a read-DAL like getCardTextSlot
 * that throws on a Supabase read error) comes back as the typed
 * `{ status: "error", … }` envelope the UI switches on — instead of rejecting
 * the Server Action raw (which the client would only see as a sanitized
 * generic error). We re-capture to Sentry here because catching inside the
 * wrapped body means `withServerActionInstrumentation` no longer sees a throw.
 * Addresses the server-action-envelope-sentry gate finding across all 11 actions.
 */
function directAction(
  actionName: string,
  inner: (args: unknown) => Promise<DirectFormState>,
): (args: unknown) => Promise<DirectFormState> {
  return wrapAdminAction(
    actionName,
    async (args: unknown): Promise<DirectFormState> => {
      try {
        return await inner(args);
      } catch (e) {
        Sentry.captureException(e, { tags: { admin_action: actionName } });
        return {
          status: "error",
          error: e instanceof Error ? e.message : "Unexpected error",
          timestamp: Date.now(),
        };
      }
    },
  );
}

// ─── appointment limits ──────────────────────────────────────────────────────

const limitsSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  is_closed: z.coerce.boolean().optional(),
  waiter_8am_slots: z.coerce.number().int().min(0).max(20).optional(),
  waiter_9am_slots: z.coerce.number().int().min(0).max(20).optional(),
  dropoff_total: z.coerce.number().int().min(0).max(200).optional(),
  notes: z.string().max(300).nullable().optional(),
  expected_updated_at: z.string().optional(),
});

export const setAppointmentLimitsAction = directAction(
  "setAppointmentLimitsAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = limitsSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { day_of_week, expected_updated_at, ...patch } = parsed.data;
    const result = await setAppointmentLimits(admin.email, day_of_week, patch, expected_updated_at);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

// ─── closed dates ────────────────────────────────────────────────────────────

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const addClosedDateAction = directAction(
  "addClosedDateAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = z
      .object({ closed_date: dateSchema, reason: z.string().trim().min(2).max(120) })
      .safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await addClosedDate(admin.email, parsed.data.closed_date, parsed.data.reason);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

export const removeClosedDateAction = directAction(
  "removeClosedDateAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = z.object({ closed_date: dateSchema }).safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await removeClosedDate(admin.email, parsed.data.closed_date);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

// ─── capacity blocks (direct port of the orchestrator tool pair) ────────────

const blockSchema = z.object({
  date: dateSchema,
  type: z.enum(["waiter", "dropoff"]).optional(),
  time: z.enum(["08:00", "09:00"]).optional(),
  reason: z.string().max(200).optional(),
});

export const blockCapacityDirectAction = directAction(
  "blockCapacityDirectAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = blockSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await blockCapacity(admin.email, parsed.data);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

export const unblockCapacityDirectAction = directAction(
  "unblockCapacityDirectAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = blockSchema.omit({ reason: true }).safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await unblockCapacity(admin.email, parsed.data);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

// ─── appointment types ───────────────────────────────────────────────────────

const typeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_]{2,40}$/),
  label: z.string().trim().min(1).max(30).optional(),
  card_title: z.string().trim().min(1).max(60).optional(),
  card_description: z.string().max(300).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
  tekmetric_color: z.enum(["red", "navy", "orange", "yellow"]).optional(),
  active: z.coerce.boolean().optional(),
  sort: z.coerce.number().int().min(0).max(9999).optional(),
  expected_updated_at: z.string().optional(),
});

export const setAppointmentTypeAction = directAction(
  "setAppointmentTypeAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = typeSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { expected_updated_at, ...type } = parsed.data;
    const result = await setAppointmentType(admin.email, type, expected_updated_at);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

export const deactivateAppointmentTypeAction = directAction(
  "deactivateAppointmentTypeAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = z.object({ id: z.string().uuid() }).safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await deactivateAppointmentType(admin.email, parsed.data.id);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

// ─── message templates (sub-feature C) ──────────────────────────────────────

const templateSchema = z.object({
  type_id: z.string().uuid().nullable(),
  kind: z.enum(["confirmation", "reminder_24h", "reminder_2h"]),
  channel: z.enum(["sms", "email"]),
  subject: z.string().trim().max(120).nullable(),
  body: z.string().trim().min(10).max(4000),
  expected_updated_at: z.string().optional(),
});

export const setMessageTemplateAction = directAction(
  "setMessageTemplateAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = templateSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { expected_updated_at, ...tpl } = parsed.data;

    // Renderer validation: unknown {{tokens}} are rejected at SAVE (plan §9:
    // fail-closed at send is the last line, not the first).
    const rendered = renderTemplate(tpl.body, "sample");
    if (!rendered.ok) {
      return validationError(`Unknown merge fields: ${rendered.unknown_tokens.join(", ")}`);
    }
    if (tpl.channel === "sms") {
      const sms = validateSmsTemplateBody(tpl.body);
      if (!sms.ok) return validationError(sms.error);
      if (tpl.subject) return validationError("SMS templates have no subject line.");
    } else if (!tpl.subject || tpl.subject.length === 0) {
      return validationError("Email templates need a subject line.");
    }

    const result = await setMessageTemplate(
      admin.email,
      { ...tpl, subject: tpl.channel === "sms" ? null : tpl.subject },
      expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

// ─── ops ─────────────────────────────────────────────────────────────────────

export const runAppointmentsSyncDirectAction = directAction(
  "runAppointmentsSyncDirectAction",
  async (args: unknown): Promise<DirectFormState> => {
    await requireAdmin();
    const parsed = z.object({ full_backfill: z.coerce.boolean().optional() }).safeParse(args ?? {});
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const res = await runAppointmentsSyncDirect(parsed.data);
    if (!res.ok) {
      return {
        status: "error",
        error: `appointments-sync returned HTTP ${res.status}`,
        timestamp: Date.now(),
      };
    }
    revalidatePath(CONFIG_PATH);
    return { status: "success", timestamp: Date.now() };
  },
);

// ─── card text (card-text-editor) ──────────────────────────────────────────

const cardTextSchema = z.object({
  card_key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  slot_key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  body: z.string().trim().min(1).max(2000),
  expected_updated_at: z.string().optional(),
});

export const setCardTextAction = directAction(
  "setCardTextAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = cardTextSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const { card_key, slot_key, body, expected_updated_at } = parsed.data;
    // Structural fields (label/default/allowed/sort) come from the seeded row,
    // NEVER the client — the client only supplies the new body.
    const row = await getCardTextSlot(card_key, slot_key);
    if (!row) {
      return validationError(`Unknown card slot: ${card_key}.${slot_key}`);
    }
    const check = validateCardTextBody(body, row.allowed_merge_fields);
    if (!check.ok) {
      return validationError(check.error);
    }
    const result = await setCardText(
      admin.email,
      {
        card_key,
        slot_key,
        body,
        label: row.label,
        default_body: row.default_body,
        allowed_merge_fields: row.allowed_merge_fields,
        sort: row.sort,
      },
      expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

const resetCardTextSchema = z.object({
  card_key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  slot_key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  expected_updated_at: z.string().optional(),
});

export const resetCardTextAction = directAction(
  "resetCardTextAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = resetCardTextSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const { card_key, slot_key, expected_updated_at } = parsed.data;
    const result = await resetCardText(
      admin.email,
      { card_key, slot_key },
      expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);
