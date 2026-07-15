"use client";

/**
 * ResendPaySummariesButton — the C27 "resend failed pay summaries" affordance on a
 * COMPLETED run (plan §5 / decision #58). The completion-time fan-out emails each
 * employee their pay summary; a transient transport failure lands that row `failed`
 * in the email log. This button re-runs the isolated failed→pending retry
 * (resendPaySummariesAction → resendFailedPaySummaries) and shows the tally. A clean
 * run with nothing failed is a safe no-op (attempted 0). Admin-only (the action
 * re-checks server-side); rendered only on completed runs.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { resendPaySummariesAction } from "@/actions/payroll-pto";
import { Button } from "@/components/ui/button";

export function ResendPaySummariesButton({ runId }: { runId: string }) {
  const [state, dispatch, pending] = useActionState(resendPaySummariesAction, null);
  const [, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      const { attempted, sent, failed } = state.data;
      setMsg(
        attempted === 0
          ? "No failed pay summaries to resend."
          : `Resent ${sent} of ${attempted}${failed > 0 ? ` — ${failed} still failed` : ""}.`,
      );
    } else {
      setMsg(state.message);
    }
  }, [state]);

  function resend() {
    setMsg(null);
    const fd = new FormData();
    fd.set("run_id", runId);
    start(() => dispatch(fd));
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={pending}
        loadingText="Resending…"
        onClick={resend}
      >
        <MailCheck aria-hidden="true" />
        Resend pay summaries
      </Button>
      {msg && (
        <span className={`text-sm ${state?.ok === false ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
          {msg}
        </span>
      )}
    </span>
  );
}
