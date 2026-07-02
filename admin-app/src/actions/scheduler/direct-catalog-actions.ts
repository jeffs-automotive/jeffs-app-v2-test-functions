"use server";

/**
 * Direct webform actions — catalog surfaces (sub-feature A, 2026-07-02).
 * Replaces the MD-upload orchestrator pipeline: thin wrappers (requireAdmin
 * → Zod → write-dal RPC) per pattern-compliance. The RPCs write the audit
 * row atomically; `expected_updated_at` carries the render-time staleness
 * token. shop_id is never accepted from the client (SHOP_ID in the DAL).
 */
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
  updateCategoryGuideline,
  updateQuestionRequiredFacts,
  updateSubcategoryEnrichment,
  updateSubcategoryServiceMap,
  upsertConcernQuestion,
  upsertRoutineService,
  upsertTestingService,
} from "@/lib/scheduler/write-dal";

const CONFIG_PATH = "/schedulerconfig";

const serviceSchema = z.object({
  service_key: z.string().regex(/^[a-z0-9_]{2,60}$/),
  display_name: z.string().trim().min(1).max(80).optional(),
  abbreviation: z.string().trim().min(1).max(12).optional(),
  display_order: z.coerce.number().int().min(0).max(9999).optional(),
  active: z.coerce.boolean().optional(),
  starting_price_cents: z.coerce.number().int().min(0).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  wait_eligible: z.coerce.boolean().optional(),
  requires_explanation: z.coerce.boolean().optional(),
  price_waived_note: z.string().max(200).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  expected_updated_at: z.string().optional(),
});

async function runServiceUpsert(
  kind: "routine" | "testing",
  raw: unknown,
): Promise<DirectFormState> {
  const admin = await requireAdmin();
  const parsed = serviceSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { expected_updated_at, ...service } = parsed.data;
  const fn = kind === "routine" ? upsertRoutineService : upsertTestingService;
  const result = await fn(admin.email, service, expected_updated_at);
  if (result.ok) revalidatePath(CONFIG_PATH);
  return stateFromResult(result);
}

export const upsertRoutineServiceAction = wrapAdminAction(
  "upsertRoutineServiceAction",
  async (args: unknown) => runServiceUpsert("routine", args),
);

export const upsertTestingServiceAction = wrapAdminAction(
  "upsertTestingServiceAction",
  async (args: unknown) => runServiceUpsert("testing", args),
);

const enrichmentSchema = z.object({
  subcategory_id: z.coerce.number().int().positive(),
  description: z.string().max(2000).optional(),
  display_label: z.string().trim().min(1).max(80).optional(),
  display_order: z.coerce.number().int().min(0).optional(),
  active: z.coerce.boolean().optional(),
  positive_examples: z.array(z.string().max(300)).max(30).optional(),
  negative_examples: z.array(z.string().max(300)).max(30).optional(),
  synonyms: z.array(z.string().max(100)).max(50).optional(),
  expected_updated_at: z.string().optional(),
});

export const updateSubcategoryEnrichmentAction = wrapAdminAction(
  "updateSubcategoryEnrichmentAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = enrichmentSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { subcategory_id, expected_updated_at, ...patch } = parsed.data;
    const result = await updateSubcategoryEnrichment(
      admin.email,
      subcategory_id,
      patch,
      expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

const serviceMapSchema = z.object({
  subcategory_id: z.coerce.number().int().positive(),
  eligible_keys: z.array(z.string().regex(/^[a-z0-9_]{2,60}$/)).max(30),
  expected_updated_at: z.string().optional(),
});

export const updateSubcategoryServiceMapAction = wrapAdminAction(
  "updateSubcategoryServiceMapAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = serviceMapSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await updateSubcategoryServiceMap(
      admin.email,
      parsed.data.subcategory_id,
      parsed.data.eligible_keys,
      parsed.data.expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

const requiredFactsSchema = z.object({
  question_id: z.coerce.number().int().positive(),
  required_facts: z.array(z.string().regex(/^[a-z0-9_.]{2,80}$/)).max(29),
  expected_updated_at: z.string().optional(),
});

export const updateQuestionRequiredFactsAction = wrapAdminAction(
  "updateQuestionRequiredFactsAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = requiredFactsSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await updateQuestionRequiredFacts(
      admin.email,
      parsed.data.question_id,
      parsed.data.required_facts,
      parsed.data.expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

const questionSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  subcategory_id: z.coerce.number().int().positive(),
  question_text: z.string().trim().min(5).max(500),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(120) }))
    .min(2)
    .max(12),
  display_order: z.coerce.number().int().min(0).optional(),
  active: z.coerce.boolean().optional(),
  multi_select: z.coerce.boolean().optional(),
  required_facts: z.array(z.string().max(80)).max(29).optional(),
  expected_updated_at: z.string().optional(),
});

export const upsertConcernQuestionAction = wrapAdminAction(
  "upsertConcernQuestionAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = questionSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const { expected_updated_at, ...question } = parsed.data;
    const result = await upsertConcernQuestion(admin.email, question, expected_updated_at);
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);

const guidelineSchema = z.object({
  category: z.string().regex(/^[a-z_]{3,40}$/),
  display_label: z.string().trim().max(80).nullable().optional(),
  guideline_prose: z.string().trim().min(20).max(8000),
  expected_updated_at: z.string().optional(),
});

export const updateCategoryGuidelineAction = wrapAdminAction(
  "updateCategoryGuidelineAction",
  async (args: unknown): Promise<DirectFormState> => {
    const admin = await requireAdmin();
    const parsed = guidelineSchema.safeParse(args);
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const result = await updateCategoryGuideline(
      admin.email,
      parsed.data.category,
      parsed.data.display_label ?? null,
      parsed.data.guideline_prose,
      parsed.data.expected_updated_at,
    );
    if (result.ok) revalidatePath(CONFIG_PATH);
    return stateFromResult(result);
  },
);
