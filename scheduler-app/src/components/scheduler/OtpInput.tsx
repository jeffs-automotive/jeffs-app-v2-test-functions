"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { Button, Card } from "@/components/ui";

/**
 * OtpInput rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5 + chat-design.md §Step 3 lines 645-658:
 * - Input: { phone_last_four: string, ttl_seconds: number, attempts_remaining?: number }
 * - Output: { code: string } or { action: "resend" }
 *
 * Phase 1 OTP parameters: 6-digit numeric, 5-min TTL, max 3 attempts per
 * session (chat-design.md line 652-658), 30-second resend cooldown
 * (chat-design.md line 645-651).
 *
 * UX:
 * - Six individual digit inputs (better mobile UX than one 6-char field)
 * - Auto-advance focus on input; backspace moves to previous
 * - Paste handling: distributes a 6-digit clipboard value across the boxes
 * - Countdown shown using `ttl_seconds`
 * - Resend button appears after 30s cooldown elapses
 * - Attempts-remaining counter surfaces after wrong code (closes G7)
 * - 3-strike escalation hint surfaces at attempts_remaining <= 1
 * - Heritage styling: Fraunces title, paper card surface, ink-secondary
 *   description, status-error countdown when expired
 */

export interface OtpInputProps {
  phone_last_four: string;
  ttl_seconds: number;
  /**
   * Remaining attempts for THIS session (NOT this code). When 0, the
   * server has already escalated; this card shouldn't even render at
   * that point — but we defensively disable submit if it does. When 1,
   * we surface a "last try" hint. Optional — older Server Action returns
   * may not include it.
   */
  attempts_remaining?: number;
  onSubmit: (output: { code: string } | { action: "resend" }) => void | Promise<void>;
  disabled?: boolean;
}

const DIGIT_COUNT = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export function OtpInput({
  phone_last_four,
  ttl_seconds,
  attempts_remaining,
  onSubmit,
  disabled = false,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() =>
    Array<string>(DIGIT_COUNT).fill(""),
  );
  const [secondsLeft, setSecondsLeft] = useState(ttl_seconds);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [pendingResend, setPendingResend] = useState(false);
  const [pendingVerify, setPendingVerify] = useState(false);
  const submittedRef = useRef<string | null>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [secondsLeft]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(
      () => setResendCooldown((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Submit when the customer fills the 6th digit.
  // Phase 9c hotfix 2026-05-16: track pending state so the card shows a
  // visible "Verifying…" indicator instead of looking idle. Also guard
  // against React 18 strict-mode double-mount by remembering the last
  // submitted code (`submittedRef`) and not re-submitting the same code.
  useEffect(() => {
    const code = digits.join("");
    if (code.length !== DIGIT_COUNT || disabled || pendingVerify) return;
    if (submittedRef.current === code) return; // already in flight / submitted
    submittedRef.current = code;
    setPendingVerify(true);
    void (async () => {
      try {
        await onSubmit({ code });
      } finally {
        // Stay pending — page should be revalidating to the next step.
        // If revalidate races and we stay on this card (e.g., invalid_code),
        // the parent will rerender with new attempts_remaining and the
        // customer can re-edit a digit; that state change clears the
        // submittedRef pin via the !pendingVerify branch above + the dep
        // re-run.
        setPendingVerify(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits.join("")]);

  function setDigitAt(idx: number, value: string) {
    setDigits((current) => {
      const next = [...current];
      next[idx] = value.slice(0, 1).replace(/\D/g, "");
      return next;
    });
  }

  function handleKeyDown(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (!digits[idx] && idx > 0) {
        inputRefs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < DIGIT_COUNT - 1) {
      inputRefs.current[idx + 1]?.focus();
    } else if (/^[0-9]$/.test(e.key)) {
      if (idx < DIGIT_COUNT - 1) {
        setTimeout(() => inputRefs.current[idx + 1]?.focus(), 0);
      }
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, DIGIT_COUNT);
    if (text.length === 0) return;
    setDigits(() => {
      const next = Array<string>(DIGIT_COUNT).fill("");
      for (let i = 0; i < text.length; i++) {
        next[i] = text[i] ?? "";
      }
      return next;
    });
    inputRefs.current[Math.min(text.length, DIGIT_COUNT - 1)]?.focus();
  }

  async function handleResend() {
    if (pendingResend || disabled || resendCooldown > 0) return;
    setPendingResend(true);
    try {
      await onSubmit({ action: "resend" });
      // Reset for the new code that's coming
      setDigits(Array<string>(DIGIT_COUNT).fill(""));
      setSecondsLeft(ttl_seconds);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      inputRefs.current[0]?.focus();
    } finally {
      setPendingResend(false);
    }
  }

  const expired = secondsLeft <= 0;
  const canResend =
    resendCooldown <= 0 && !pendingResend && !disabled && !pendingVerify;
  const isLastTry =
    typeof attempts_remaining === "number" && attempts_remaining <= 1;
  const noAttemptsLeft =
    typeof attempts_remaining === "number" && attempts_remaining <= 0;

  return (
    <Card aria-labelledby="otp-heading">
      <Card.Eyebrow>Step 3 · Verify your phone</Card.Eyebrow>
      <Card.Title id="otp-heading">Enter your code 📲</Card.Title>
      <Card.Description>
        I sent a 6-digit code to your phone ending in{" "}
        <span className="font-mono font-medium text-ink">{phone_last_four}</span>.
        {expired ? null : (
          <>
            {" "}
            Expires in{" "}
            <span className="font-mono font-medium text-ink">
              {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </span>
            .
          </>
        )}
      </Card.Description>

      <Card.Body>
        <div className="flex flex-wrap gap-2" role="group" aria-label="6-digit code">
          {digits.map((d, idx) => (
            <input
              // eslint-disable-next-line react/no-array-index-key
              key={idx}
              ref={(el) => {
                inputRefs.current[idx] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={idx === 0 ? "one-time-code" : "off"}
              maxLength={1}
              aria-label={`Digit ${idx + 1} of ${DIGIT_COUNT}`}
              value={d}
              disabled={disabled || expired || noAttemptsLeft || pendingVerify}
              onChange={(e) => setDigitAt(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              onPaste={handlePaste}
              className={
                "h-14 w-12 rounded-[var(--radius-input)] border bg-paper-100 " +
                "text-center font-mono text-2xl text-ink " +
                "focus:border-brand-burgundy-500 focus:outline-none " +
                "focus:ring-2 focus:ring-brand-burgundy-200 " +
                "disabled:bg-paper-200 disabled:cursor-not-allowed " +
                "transition-colors " +
                (expired || noAttemptsLeft
                  ? "border-status-error-fg"
                  : "border-rule")
              }
            />
          ))}
        </div>

        {pendingVerify ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 text-[13px] leading-snug text-ink-secondary"
          >
            🔐 Verifying your code…
          </p>
        ) : null}

        {expired && !pendingVerify ? (
          <p
            role="alert"
            className="mt-3 text-[13px] leading-snug text-status-error-fg"
          >
            ⏰ This code expired. Tap &quot;Resend code&quot; below for a fresh one.
          </p>
        ) : null}

        {isLastTry && !noAttemptsLeft ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 text-[13px] leading-snug text-status-warning-fg"
          >
            ⚠️ One try left — if this code is wrong, we&apos;ll have someone
            help you directly.
          </p>
        ) : typeof attempts_remaining === "number" &&
          attempts_remaining > 0 &&
          attempts_remaining < 3 ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 text-[13px] leading-snug text-ink-tertiary"
          >
            {attempts_remaining} tries left.
          </p>
        ) : null}

        {/* Resend button — appears after 30s cooldown */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canResend}
            loading={pendingResend}
            onClick={handleResend}
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : "Resend code"}
          </Button>
        </div>
      </Card.Body>

      <Card.Footnote>
        If texts aren&apos;t coming through, tap &quot;Talk to a person&quot;
        below — we&apos;ll get you scheduled directly.
      </Card.Footnote>
    </Card>
  );
}
