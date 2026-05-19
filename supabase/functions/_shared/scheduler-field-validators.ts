// scheduler-field-validators.ts — shared validators for testing_services +
// routine_services field values.
//
// Used by BOTH:
//   - Bulk MD-upload path (scheduler-admin-catalog.ts)
//   - Single-row patch path (scheduler-pricing.ts)
//
// So an advisor editing one row via patch_testing_service_fields hits the
// SAME validation as a bulk MD re-upload — no asymmetry where a bad price
// or invalid concern_category sneaks through one path but not the other.
//
// Each validator returns { ok: true } on pass, or { ok: false, message } on
// fail. Callers compose: any failure → reject the operation, surface message
// back to the advisor for fixup.

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

const CONCERN_CATEGORY_SLUGS = new Set([
  "noise", "vibration", "pulling", "smell", "smoke", "leak", "warning_light",
  "performance", "electrical", "hvac", "brakes", "steering", "tires", "other",
]);

export const MIN_DESCRIPTION_LEN = 10;
export const MAX_DESCRIPTION_LEN = 500;
export const MAX_ABBREVIATION_LEN = 30;
export const SERVICE_KEY_RE = /^[a-z0-9_]+$/;

export function validateServiceKey(key: string): ValidationResult {
  if (!key) return { ok: false, message: "service_key required" };
  if (!SERVICE_KEY_RE.test(key)) {
    return { ok: false, message: `service_key "${key}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores)` };
  }
  return { ok: true };
}

export function validateConcernCategories(
  categories: string[] | null | undefined,
): ValidationResult {
  if (categories === null || categories === undefined) return { ok: true };
  for (const cat of categories) {
    if (!CONCERN_CATEGORY_SLUGS.has(cat)) {
      return {
        ok: false,
        message: `concern_categories: "${cat}" is not one of the 14 canonical slugs (noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other)`,
      };
    }
  }
  return { ok: true };
}

export function validateDescription(
  description: string | null | undefined,
): ValidationResult {
  if (description === null || description === undefined) return { ok: true };
  const trimmed = description.trim();
  if (trimmed.length > 0 && trimmed.length < MIN_DESCRIPTION_LEN) {
    return {
      ok: false,
      message: `description: ${trimmed.length} chars — too short. Write a complete sentence (min ${MIN_DESCRIPTION_LEN}).`,
    };
  }
  if (trimmed.length > MAX_DESCRIPTION_LEN) {
    return {
      ok: false,
      message: `description: ${trimmed.length} chars — too long. Trim to 1-2 sentences (max ${MAX_DESCRIPTION_LEN}).`,
    };
  }
  return { ok: true };
}

export function validateAbbreviation(
  abbreviation: string | null | undefined,
): ValidationResult {
  if (abbreviation === null || abbreviation === undefined) return { ok: true };
  if (!abbreviation) return { ok: false, message: "abbreviation required" };
  if (abbreviation.length > MAX_ABBREVIATION_LEN) {
    return {
      ok: false,
      message: `abbreviation: ${abbreviation.length} chars — max ${MAX_ABBREVIATION_LEN}`,
    };
  }
  return { ok: true };
}

export function validatePriceCents(
  cents: number | null | undefined,
): ValidationResult {
  if (cents === null || cents === undefined) return { ok: true };
  if (!Number.isInteger(cents)) {
    return { ok: false, message: `starting_price_cents: ${cents} is not an integer` };
  }
  if (cents < 0) {
    return { ok: false, message: `starting_price_cents: ${cents} must be >= 0` };
  }
  return { ok: true };
}

/**
 * Convenience: run all relevant validators against a partial patch payload.
 * Returns the FIRST failure (so the advisor fixes one thing at a time);
 * pass undefined for fields that aren't being patched.
 */
export function validatePatchFields(args: {
  service_key?: string;
  abbreviation?: string | null;
  starting_price_cents?: number | null;
  description?: string | null;
  concern_categories?: string[] | null;
}): ValidationResult {
  if (args.service_key !== undefined) {
    const r = validateServiceKey(args.service_key);
    if (!r.ok) return r;
  }
  if (args.abbreviation !== undefined) {
    const r = validateAbbreviation(args.abbreviation);
    if (!r.ok) return r;
  }
  if (args.starting_price_cents !== undefined) {
    const r = validatePriceCents(args.starting_price_cents);
    if (!r.ok) return r;
  }
  if (args.description !== undefined) {
    const r = validateDescription(args.description);
    if (!r.ok) return r;
  }
  if (args.concern_categories !== undefined) {
    const r = validateConcernCategories(args.concern_categories);
    if (!r.ok) return r;
  }
  return { ok: true };
}
