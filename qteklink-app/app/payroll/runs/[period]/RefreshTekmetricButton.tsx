"use client";

/**
 * RefreshTekmetricButton — admin affordance on an OPEN run's data-as-of line
 * (design spec §3 header): dispatches the existing
 * refreshPayrollTekmetricDataAction (range-mode mirror ingest over the period,
 * plus the bonus month when the slider is on), reports the result inline, and
 * router.refresh()es so the recomputed numbers render.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshPayrollTekmetricDataAction } from "@/actions/payroll";
import { Button } from "@/components/ui/button";

export function RefreshTekmetricButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function refresh() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      const res = await refreshPayrollTekmetricDataAction(null, fd);
      if (res.ok) {
        const parts = [`Refreshed ${res.data.rosUpserted} repair orders`];
        if (res.data.bonusMonthRosUpserted !== null) {
          parts.push(`${res.data.bonusMonthRosUpserted} for the bonus month`);
        }
        if (res.data.newCategories.length > 0) {
          parts.push(`${res.data.newCategories.length} new spiff categories found`);
        }
        setMsg({ kind: "ok", text: `${parts.join(" · ")}.` });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={pending}
        loadingText="Refreshing…"
        onClick={refresh}
      >
        <RefreshCw aria-hidden="true" />
        Refresh Tekmetric data
      </Button>
      {msg && (
        <span
          className={`text-xs ${msg.kind === "ok" ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-400"}`}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
