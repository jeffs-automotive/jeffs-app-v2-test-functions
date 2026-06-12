"use client";

/**
 * DateNav — the day-page date control (approvals + every day-detail sub-page). A
 * CONTROLLED date input (value={date}) so the box always reflects the current day
 * (it updates when the ◀/▶ arrows change the URL), and it NAVIGATES on change
 * (router.push) so picking a date jumps immediately — no submit button.
 *
 * The destination is `${hrefPrefix}${date}${hrefSuffix}` (plain strings — a server
 * component can pass them): the approvals default is `/approvals?date=<d>`; the
 * breakdown page passes prefix "/approvals/" + suffix "/breakdown?tab=…"; the
 * fix-it list passes prefix "/approvals/review?date=".
 */
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDaysIso } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function DateNav({
  date,
  hrefPrefix = "/approvals?date=",
  hrefSuffix = "",
}: {
  date: string;
  hrefPrefix?: string;
  hrefSuffix?: string;
}) {
  const router = useRouter();
  const go = (d: string) => router.push(`${hrefPrefix}${d}${hrefSuffix}`);

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
