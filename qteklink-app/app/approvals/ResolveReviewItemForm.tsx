"use client";

/**
 * ResolveReviewItemForm (C7, admin-only) — close one §9 review item via
 * resolveReviewItemAction. On success it router.refresh()es so the queue updates.
 * The id is a hidden field; the action re-validates it + scopes the resolve to the
 * session shop+realm server-side.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { resolveReviewItemAction } from "@/actions/review-items";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ResolveReviewItemForm({ id }: { id: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(resolveReviewItemAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="resolution_note"
        maxLength={2000}
        placeholder="Resolution note (optional)"
        className="flex-1"
      />
      <Button type="submit" size="sm" loading={pending} loadingText="Resolving…">
        <Check aria-hidden="true" />
        Resolve
      </Button>
      {state?.ok === false && <span className="text-xs text-red-700">{state.message}</span>}
    </form>
  );
}
