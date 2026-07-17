"use client";

/**
 * ViewAttachmentButton — pulls the scanned parts-invoice image attached to this Bill/
 * Purchase in QuickBooks and shows it in a dialog. The fetch state lives in a child mounted
 * INSIDE the dialog content, so it re-mounts fresh each open (the QBO download URL is
 * short-lived — never shows a stale/expired image from a prior open). A load skeleton and a
 * broken-image fallback keep both async states designed. Read-only.
 */
import { useActionState, useState } from "react";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchAttachmentsAction } from "@/actions/back-office/issues";
import type { VendorDocType } from "@/lib/qbo/vendor-docs";

function AttachmentImage({ uri, name }: { uri: string; name: string | null }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary underline"
      >
        <ExternalLink aria-hidden="true" className="size-3.5" />
        Couldn&apos;t preview — open in QuickBooks
      </a>
    );
  }
  return (
    <a href={uri} target="_blank" rel="noopener noreferrer">
      {/* External short-lived QBO URL — next/image can't optimize it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={uri}
        alt={name ?? "Parts invoice"}
        onError={() => setErrored(true)}
        className="max-h-[60vh] w-full rounded-md border border-border object-contain"
      />
    </a>
  );
}

function AttachmentContent({ qboTxnType, qboTxnId }: { qboTxnType: VendorDocType; qboTxnId: string }) {
  const [state, action, pending] = useActionState(fetchAttachmentsAction, null);
  return (
    <>
      <form action={action} className="mt-2">
        <input type="hidden" name="qbo_txn_type" value={qboTxnType} />
        <input type="hidden" name="qbo_txn_id" value={qboTxnId} />
        <Button type="submit" size="sm" variant="outline" loading={pending} loadingText="Loading…">
          <ImageIcon aria-hidden="true" />
          Load image
        </Button>
      </form>

      {pending && <Skeleton className="mt-3 h-64 w-full" />}
      {!pending && state?.ok === false && <p className="mt-3 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
      {!pending && state?.ok && state.data.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No document is attached to this bill in QuickBooks.</p>
      )}
      {!pending && state?.ok && state.data.length > 0 && (
        <div className="mt-3 grid gap-3">
          {state.data.map((a) => (
            <figure key={a.qboAttachableId} className="m-0">
              {a.tempDownloadUri ? (
                <AttachmentImage uri={a.tempDownloadUri} name={a.fileName} />
              ) : (
                <p className="text-sm text-muted-foreground">{a.fileName ?? "Attachment"} (no preview available)</p>
              )}
              {a.fileName && <figcaption className="mt-1 text-xs text-muted-foreground">{a.fileName}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </>
  );
}

export function ViewAttachmentButton({ qboTxnType, qboTxnId }: { qboTxnType: VendorDocType; qboTxnId: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <ImageIcon aria-hidden="true" />
        Image
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Parts invoice</DialogTitle>
          <DialogDescription>The scanned document attached to this bill in QuickBooks.</DialogDescription>
        </DialogHeader>
        {/* Mounted fresh each open (DialogContent unmounts on close) → no stale/expired URLs. */}
        <AttachmentContent qboTxnType={qboTxnType} qboTxnId={qboTxnId} />
      </DialogContent>
    </Dialog>
  );
}
