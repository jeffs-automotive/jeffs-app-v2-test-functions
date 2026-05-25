"use client";

/**
 * WizardCrossCutting — Phase 14 client wrapper that bundles the always-
 * visible page-footer affordances (Start Over + Talk to a person), the
 * idle / abandon timer, and the offline banner.
 *
 * Sits in /book-v2/page.tsx beside WizardSurface. Pure presentation +
 * Server Action wiring; no row state.
 *
 * Skips the cross-cutting footer + idle timer when the wizard is on a
 * terminal step (escalated, completed, abandoned) — Start Over still
 * works at terminals (it's just the IdleTimer that's silenced).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WizardFooter } from "@/components/scheduler/heritage/WizardFooter";
import { submitEscalateV2 } from "@/lib/scheduler/wizard/actions/submit-escalate";
import { submitStartOverV2 } from "@/lib/scheduler/wizard/actions/submit-start-over";

import { IdleTimer } from "./IdleTimer";
import { OfflineBanner } from "./OfflineBanner";

export interface WizardCrossCuttingProps {
  chatId: string;
  currentStep: string;
  /**
   * HMAC-SHA256 over (chatId + currentStep + "idle_timer") as base64url —
   * computed server-side in BookPageShell. Attached when the idle-timer
   * fires the beacon. Empty string when SCHEDULER_BEACON_HMAC_SECRET
   * is unset (dev / pre-launch); the route falls back to "skipped".
   */
  beaconSigIdle: string;
  /**
   * HMAC-SHA256 over (chatId + currentStep + "tab_close") as base64url —
   * computed server-side in BookPageShell. Attached when pagehide /
   * beforeunload fires the beacon.
   */
  beaconSigTab: string;
}

const TERMINAL_STEPS = new Set<string>(["escalated", "completed", "abandoned"]);

export function WizardCrossCutting({
  chatId,
  currentStep,
  beaconSigIdle,
  beaconSigTab,
}: WizardCrossCuttingProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const isTerminal = TERMINAL_STEPS.has(currentStep);

  async function handleStartOver() {
    if (pending) return;
    setPending(true);
    try {
      await submitStartOverV2({ chatId });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleEscalate() {
    if (pending) return;
    setPending(true);
    try {
      await submitEscalateV2({ chatId, reason: "manual_button_tap" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <OfflineBanner />
      <IdleTimer
        chatId={chatId}
        currentStep={currentStep}
        beaconSigIdle={beaconSigIdle}
        beaconSigTab={beaconSigTab}
        disabled={isTerminal}
      />
      <WizardFooter
        disabled={pending}
        onStartOver={handleStartOver}
        onEscalate={handleEscalate}
      />
    </>
  );
}
