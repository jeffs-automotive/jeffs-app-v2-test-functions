"use client";

/**
 * ApprovePostingButtons (C8c, admin-only) — approve a pending posting (the human gate)
 * or reject a pending/approved one. router.refresh() on success. No QBO write here —
 * approval just moves the row to 'approved'; the live post is the separate Post button.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { approvePostingAction, rejectPostingAction } from "@/actions/postings";

export default function ApprovePostingButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [aState, approveAction, aPending] = useActionState(approvePostingAction, null);
  const [rState, rejectAction, rPending] = useActionState(rejectPostingAction, null);

  useEffect(() => {
    if (aState?.ok || rState?.ok) router.refresh();
  }, [aState?.timestamp, rState?.timestamp, aState?.ok, rState?.ok, router]);

  const err = aState?.ok === false ? aState.message : rState?.ok === false ? rState.message : null;

  return (
    <div className="mt-3 flex items-center gap-2">
      {status === "pending" && (
        <form action={approveAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={aPending} className="rounded bg-[#96003C] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60">
            {aPending ? "Approving…" : "Approve"}
          </button>
        </form>
      )}
      <form action={rejectAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={rPending} className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-600 transition hover:border-red-400 hover:text-red-700 disabled:opacity-60">
          {rPending ? "Rejecting…" : "Reject"}
        </button>
      </form>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
