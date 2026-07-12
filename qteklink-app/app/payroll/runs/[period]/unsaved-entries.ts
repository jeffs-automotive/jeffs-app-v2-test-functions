/**
 * Unsaved-entry-changes registry — the round-8 #43 leave guard's seam between
 * EntryGrid (which OWNS the dirty-cell state and the beforeunload guard) and
 * RunViewTabs (whose client-side tab switch must confirm before leaving the
 * entry grid).
 *
 * WHY a module singleton: the two client components are composed by the SERVER
 * page (EntryGrid arrives inside RunViewTabs' `entryPanel` ReactNode), so there
 * is no shared React parent to lift state into without re-plumbing the panels
 * through a client wrapper. Both components ship in the same client bundle, so
 * a plain module-scoped value is the lightest correct seam: EntryGrid writes
 * the count on every dirty-state change (and zeroes it on unmount/save);
 * RunViewTabs reads it IMPERATIVELY at click time — no subscription needed,
 * because the guard only matters at the moment of the click.
 *
 * NOTE the round-7 #41 contract: all tab panels stay MOUNTED across switches,
 * so unsaved edits SURVIVE a tab switch — the confirm is a "you haven't saved
 * yet" checkpoint (people forget and navigate away from the page later), not a
 * data-loss barrier. The wording says exactly that.
 *
 * The registry has THREE consumers: RunViewTabs (tab-switch confirm),
 * useUnsavedNavGuard (in-app route-leave confirm — App Router soft navigations
 * fire no beforeunload, so link clicks would otherwise unmount the grid and
 * silently drop typed hours), and CompleteRunButton (blocks freezing the run
 * while typed-but-unsaved cells exist — the completion snapshot is built from
 * SAVED state only).
 */

let unsavedCount = 0;

export function setUnsavedEntryCount(n: number): void {
  unsavedCount = n;
}

export function getUnsavedEntryCount(): number {
  return unsavedCount;
}

export const UNSAVED_ENTRIES_CONFIRM =
  "You have unsaved entry changes — they are NOT saved yet. " +
  "They stay on the entry grid while you look around, but don't forget to come back and save. Switch tabs anyway?";

/** Route-leave wording: unlike a tab switch, leaving the page UNMOUNTS the
 *  grid — the typed values really are gone. Say so. */
export const UNSAVED_ENTRIES_LEAVE_CONFIRM =
  "You have unsaved entry changes — they are NOT saved and will be LOST if you leave this page. " +
  "Leave anyway?";
