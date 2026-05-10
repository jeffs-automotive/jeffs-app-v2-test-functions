"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

/**
 * OtpInput rendering tool component.
 *
 * Per appointments_design.md §7.5:
 * - Input: { phone_last_four: string, ttl_seconds: number }
 * - Output: { code: string }  // 6-digit numeric
 *
 * Phase 1 OTP parameters (per scheduler_project_state.md):
 *   6-digit numeric, 5-min TTL, max 3 attempts (lockout after).
 *
 * UX notes:
 * - Six individual digit inputs (better mobile UX than one 6-char field)
 * - Auto-advance focus on input; backspace moves to previous
 * - Paste handling: distributes a 6-digit clipboard value across the boxes
 * - Countdown shown using `ttl_seconds`
 */

export interface OtpInputProps {
  phone_last_four: string;
  ttl_seconds: number;
  onSubmit: (output: { code: string }) => void | Promise<void>;
  /** When true, disables editing (e.g., after submit while orchestrator verifies). */
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
    Array<string>(DIGIT_COUNT).fill("")
  );
  const [secondsLeft, setSecondsLeft] = useState(ttl_seconds);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000
    );
    return () => clearInterval(t);
  }, [secondsLeft]);

  // Submit when the customer fills the 6th digit
  useEffect(() => {
    if (digits.every((d) => d.length === 1) && !disabled) {
      const code = digits.join("");
      void onSubmit({ code });
    }
    // Intentionally only depends on digits (not onSubmit / disabled — those
    // are stable in normal use)
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
      // The handled value is set below in onChange; just advance focus
      if (idx < DIGIT_COUNT - 1) {
        // setTimeout 0 to let React render the value first
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

  return (
    <div
      role="group"
      aria-labelledby="otp-heading"
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3 id="otp-heading" className="mb-1 text-sm font-medium text-gray-900">
        Verification code
      </h3>
      <p className="mb-3 text-sm text-gray-600">
        I sent a 6-digit code to your phone ending in{" "}
        <span className="font-mono font-medium">{phone_last_four}</span>.
        {secondsLeft > 0 ? (
          <>
            {" "}
            Expires in{" "}
            <span className="font-medium">
              {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </span>
            .
          </>
        ) : (
          <span className="text-red-600"> Code expired — request a new one.</span>
        )}
      </p>

      <div className="flex gap-2" role="presentation">
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
            disabled={disabled || secondsLeft <= 0}
            onChange={(e) => setDigitAt(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            className="h-12 w-12 rounded border border-gray-300 text-center text-xl font-mono focus:border-brand-burgundy-700 focus:outline-none focus:ring-2 focus:ring-brand-burgundy-200 disabled:bg-gray-100"
          />
        ))}
      </div>
    </div>
  );
}
