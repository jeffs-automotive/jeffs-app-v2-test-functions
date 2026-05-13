"use client";

import { type ReactNode } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";

/**
 * Heritage Editorial chat bubble.
 *
 * Visual language:
 *   - Customer bubbles (role='user'): burgundy fill, ivory text, right-aligned,
 *     max-width 85% on mobile / 70% on desktop. Slightly tighter rounded
 *     corner on the bottom-right (chat-tail vibe without an actual tail).
 *   - Assistant bubbles (role='assistant'): paper-100 surface, charcoal text,
 *     left-aligned. Thin gold hairline on the left as a quiet "Jeff is
 *     speaking" cue. Bigger left padding so the rule line breathes.
 *   - Tool-call parts render INSIDE the assistant bubble or as standalone
 *     cards depending on the part type — handled by the caller. ChatBubble
 *     itself just owns the speech-bubble container.
 *
 * Mounts with a 6px slide-up + fade — gentle, not bouncy. Respects
 * prefers-reduced-motion via globals.css override.
 */

export interface ChatBubbleProps {
  role: "user" | "assistant";
  children: ReactNode;
  /** Optional timestamp (ISO) — rendered as a tiny caption beneath the bubble. */
  timestamp?: string;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return "";
  }
}

export function ChatBubble({ role, children, timestamp }: ChatBubbleProps) {
  const isUser = role === "user";

  const bubbleClasses = isUser
    ? "ml-auto max-w-[85%] rounded-[12px] rounded-br-sm " +
      "bg-brand-burgundy-700 px-4 py-2.5 text-[15px] leading-relaxed text-paper-100 " +
      "shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:max-w-[70%]"
    : "mr-auto max-w-[85%] rounded-[12px] rounded-bl-sm " +
      "border-l-2 border-brand-gold-400 bg-paper-100 px-4 py-2.5 text-[15px] leading-relaxed text-ink " +
      "shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:max-w-[70%]";

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col"
      >
        <div className={bubbleClasses}>{children}</div>
        {timestamp ? (
          <span
            className={
              "mt-0.5 text-[11px] text-ink-tertiary " +
              (isUser ? "self-end" : "self-start")
            }
          >
            {fmtTime(timestamp)}
          </span>
        ) : null}
      </m.div>
    </LazyMotion>
  );
}
