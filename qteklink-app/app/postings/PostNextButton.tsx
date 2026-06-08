"use client";

/**
 * PostNextButton (C8c, admin-only) — ⚠️ the LIVE QBO write trigger. Posts the next
 * approved posting to QuickBooks (a real JournalEntry create) via postNextAction.
 * window.confirm guards the click; router.refresh() shows the new state.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { postNextAction } from "@/actions/postings";

export default function PostNextButton({ readyCount }: { readyCount: number }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(postNextAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Post the next approved posting to QuickBooks? This writes a real JournalEntry.")) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        disabled={pending || readyCount === 0}
        className="rounded bg-[#96003C] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-50"
      >
        {pending ? "Posting…" : "Post next approved"}
      </button>
      {state?.ok && (
        <p className="mt-2 text-xs text-stone-700">
          Result: <span className="font-medium">{state.data.status}</span>
          {state.data.status === "posted" && ` — QBO JE ${(state.data as { qboJeId?: string }).qboJeId ?? ""}`}
        </p>
      )}
      {state?.ok === false && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
    </form>
  );
}
