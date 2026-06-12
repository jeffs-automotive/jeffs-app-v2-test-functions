"use client";

/**
 * DateNav — the daily-snapshot date control. A CONTROLLED date input (value={date}) so the
 * box always reflects the current day (it updates when the ◀/▶ arrows change the URL), and it
 * NAVIGATES on change (router.push) so picking a date jumps immediately — no submit button.
 * (Replaces the earlier uncontrolled defaultValue + GET-form, which didn't update on arrow
 * nav and required a separate "Go" click.)
 */
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function DateNav({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/approvals?date=${d}`);

  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <Button type="button" variant="outline" size="icon" onClick={() => go(addDaysIso(date, -1))} aria-label="Previous day">
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Input
        type="date"
        value={date}
        onChange={(e) => { if (e.target.value) go(e.target.value); }}
        className="w-auto"
        aria-label="Pick a date"
      />
      <Button type="button" variant="outline" size="icon" onClick={() => go(addDaysIso(date, 1))} aria-label="Next day">
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
