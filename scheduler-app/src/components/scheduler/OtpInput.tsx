"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { Card } from "@/components/ui";

/**
 * OtpInput rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §7.5:
 * - Input: { phone_last_four: string, ttl_seconds: number }
 * - Output: { code: string }  // 6-digit numeric
 *
 * Phase 1 OTP parameters: 6-digit numeric, 5-min TTL, max 3 attempts.
 *
 * UX:
 * - Six individual digit inputs (better mobile UX than one 6-char field)
 * - Auto-advance focus on input; backspace moves to previous
 * - Paste handling: distributes a 6-digit clipboard value across the boxes
 * - Countdown shown using `ttl_seconds`
 * - Heritage styling: Fraunces title, paper card surface, ink-secondary
 *   description, status-error countdown when expired
 */

export interface OtpInputProps {
  phone_last_four: string;
  ttl_seconds: number;
  onSubmit: (output: { code: string }) => void | Promise<void>;
  disabled?: boolean;
}

const DIGIT_COUNT = 6;

export function OtpInput({
  phone_last_four,
  ttl_seconds,
  onSubmit,
  disabled = false,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() =>
    Array<string>(DIGIT_COUNT).fill(""),
  );
  const [secondsLeft, setSecondsLeft] = useState(ttl_seconds);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(t);
  }, [secondsLeft]);

  // Submit when the customer fills the 6th digit
  useEffect(() => {
    if (digits.every((d) => d.length === 1) && !disabled) {
      const code = digits.join("");
      void onSubmit({ code });
    }
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

  const expired = secondsLeft <= 0;

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
              disabled={disabled || expired}
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
                (expired ? "border-status-error-fg" : "border-rule")
              }
            />
          ))}
        </div>

        {expired ? (
          <p
            role="alert"
            className="mt-3 text-[13px] leading-snug text-status-error-fg"
          >
            ⏰ This code expired. Ask me to send a new one and we&apos;ll try
            again.
          </p>
        ) : null}
      </Card.Body>

      <Card.Footnote>
        Didn&apos;t get it? Wait ~30 seconds then ask for a new code. You can
        also tap &quot;Talk to a person&quot; below if texts aren&apos;t
        coming through.
      </Card.Footnote>
    </Card>
  );
}
