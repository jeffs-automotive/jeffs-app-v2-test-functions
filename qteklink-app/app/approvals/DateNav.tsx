"use client";

/**
 * DateNav — the daily-snapshot date control. A CONTROLLED date input (value={date}) so the
 * box always reflects the current day (it updates when the ◀/▶ arrows change the URL), and it
 * NAVIGATES on change (router.push) so picking a date jumps immediately — no submit button.
 * (Replaces the earlier uncontrolled defaultValue + GET-form, which didn't update on arrow
 * nav and required a separate "Go" click.)
 */
import { useRouter } from "next/navigation";
import { addDaysIso } from "@/lib/format";

export default function DateNav({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/approvals?date=${d}`);
  const arrow = "rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50";

  return (
    <div className="mt-6 flex items-center justify-center gap-3">
      <button type="button" onClick={() => go(addDaysIso(date, -1))} className={arrow} aria-label="Previous day">◀</button>
      <input
        type="date"
        value={date}
        onChange={(e) => { if (e.target.value) go(e.target.value); }}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm focus:border-[#96003C] focus:outline-none"
        aria-label="Pick a date"
      />
      <button type="button" onClick={() => go(addDaysIso(date, 1))} className={arrow} aria-label="Next day">▶</button>
    </div>
  );
}
