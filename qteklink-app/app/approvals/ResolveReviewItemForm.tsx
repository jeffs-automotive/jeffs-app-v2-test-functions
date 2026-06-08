"use client";

/**
 * ResolveReviewItemForm (C7, admin-only) — close one §9 review item via
 * resolveReviewItemAction. On success it router.refresh()es so the queue updates.
 * The id is a hidden field; the action re-validates it + scopes the resolve to the
 * session shop+realm server-side.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resolveReviewItemAction } from "@/actions/review-items";

export default function ResolveReviewItemForm({ id }: { id: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(resolveReviewItemAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="resolution_note"
        maxLength={2000}
        placeholder="Resolution note (optional)"
        className="flex-1 rounded border border-stone-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded bg-[#96003C] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60"
      >
        {pending ? "Resolving…" : "Resolve"}
      </button>
      {state?.ok === false && <span className="text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
