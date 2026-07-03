/**
 * WizardProgress — the 4-phase booking ribbon.
 *
 * PURELY PRESENTATIONAL (added 2026-06-11). The wizard flow is *branched*
 * server-state — returning vs new customer, partial-verification gates,
 * multi-account disambiguation, variable-length concern/clarification queues.
 * A numeric "Step 4 of 11" would be a LIE on most paths and computing the
 * real position needs branch state (functional, off-limits). So this maps
 * `card.step` → one of four fixed, branch-INDEPENDENT phases that every
 * customer passes through, and highlights the current one.
 *
 * This is a display mapping, NOT state-machine logic: it reads `step` (data
 * WizardSurface already has), imports no action, writes no state, and claims
 * no numeric position. It does not replace the per-card eyebrows (those name
 * the specific step within the phase).
 *
 * Accessibility: <nav aria-label="Booking progress"> wrapping an <ol>; the
 * current phase's <li> carries aria-current="step"; each <li> has an sr-only
 * state suffix ("completed" / "current step" / "upcoming") so the phase state
 * is conveyed by text, not color/shape alone (WCAG 1.4.1).
 */
import type { WizardStep } from "@/lib/scheduler/session-state";

type PhaseIndex = 0 | 1 | 2 | 3;

interface Phase {
  label: string;
}

const PHASES: readonly Phase[] = [
  { label: "You" },
  { label: "Your car" },
  { label: "The work" },
  { label: "When" },
] as const;

/**
 * step → phase index. Every step in the canonical WIZARD_STEPS list maps to
 * exactly one phase. `escalated` / `abandoned` are off the happy path and
 * render nothing (handled by the null return below, not this map).
 */
const STEP_PHASE: Partial<Record<WizardStep, PhaseIndex>> = {
  // Phase 1 — You: greeting, phone/name, OTP, verification + disambiguation +
  // customer-info steps.
  greeting: 0,
  phone_name: 0,
  otp_pending: 0,
  partial_verification_gate: 0,
  multi_account_disambiguation: 0,
  no_match_choose_path: 0,
  customer_info_edit: 0,
  new_customer_info: 0,
  // Phase 2 — Your car: vehicle pick + new vehicle.
  vehicle_pick: 1,
  new_vehicle_form: 1,
  // Phase 3 — The work: service picker, concern explanation, diagnostics,
  // clarifications, testing approval, second routine pass.
  service_concern_picker: 2,
  concern_explanation: 2,
  diagnostic_loading: 2,
  clarification_question: 2,
  concern_clarify: 2,
  testing_service_approval: 2,
  second_routine_pass: 2,
  // Phase 4 — When: appointment type, date, waiter time, notes, question,
  // summary, completed.
  appointment_type: 3,
  date_pick: 3,
  waiter_time_pick: 3,
  summary: 3,
  customer_notes: 3,
  customer_question: 3,
  completed: 3,
};

export interface WizardProgressProps {
  step: WizardStep;
}

export function WizardProgress({ step }: WizardProgressProps) {
  const current = STEP_PHASE[step];

  // Terminal / aside steps (escalated, abandoned, or any unmapped step) hide
  // the ribbon — the customer is off the happy path.
  if (current === undefined) return null;

  return (
    <nav aria-label="Booking progress" className="mx-auto mb-4 w-full max-w-3xl">
      <ol className="flex items-center gap-0">
        {PHASES.map((phase, i) => {
          const isCurrent = i === current;
          const isDone = i < current;
          const stateWord = isDone
            ? "completed"
            : isCurrent
              ? "current step"
              : "upcoming";

          // Dot styling. Completed + current: filled burgundy. Current adds a
          // 2px ring. Upcoming: hollow with the AA-safe field rule.
          const dotClass = isDone
            ? "bg-brand-burgundy-700 border-brand-burgundy-700"
            : isCurrent
              ? "bg-brand-burgundy-700 border-brand-burgundy-700 ring-2 ring-brand-burgundy-200"
              : "bg-paper-100 border-[var(--color-rule-input)]";

          // Label color: current/done step up to ink; upcoming stays AA-safe
          // tertiary. NB: we DON'T reuse the .label-eyebrow class here —
          // it's unlayered CSS and would beat the Tailwind text-* color
          // utility (unlayered wins over the utilities layer). Instead the
          // eyebrow TYPOGRAPHY (11px / 0.18em / uppercase) is spelled out in
          // utilities so the color utility applies normally.
          const labelType =
            "text-[11px] uppercase leading-[1.2] tracking-[0.18em]";
          const labelTone =
            isCurrent || isDone ? "text-ink" : "text-ink-tertiary";
          const labelWeight = isCurrent ? "font-medium" : "";
          // Mobile: only the current phase's label shows (others dots-only to
          // save width); sm: shows all four. Pure responsive classes.
          const labelVisibility = isCurrent ? "inline" : "hidden sm:inline";

          // Connector between dots (not before the first). Completed segments
          // get burgundy; upcoming get the decorative rule.
          const connectorClass = i <= current ? "bg-brand-burgundy-700" : "bg-rule";

          return (
            <li
              key={phase.label}
              aria-current={isCurrent ? "step" : undefined}
              className="flex flex-1 items-center last:flex-none"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${dotClass}`}
                />
                <span
                  className={`${labelType} ${labelTone} ${labelWeight} ${labelVisibility}`}
                >
                  {phase.label}
                </span>
                <span className="sr-only">
                  {phase.label}: {stateWord}
                </span>
              </span>
              {i < PHASES.length - 1 ? (
                <span
                  aria-hidden
                  className={`mx-2 h-px flex-1 ${connectorClass}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
