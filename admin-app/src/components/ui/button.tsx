import type { ReactNode } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * Button extends shadcn's base with two pending-state props for our
 * keytag forms (loading-spinners plan §3a, 2026-05-25):
 *
 *   loading?: boolean      — when true, the button is disabled +
 *                            aria-busy + the leading icon is replaced
 *                            by an animated Loader2 spinner.
 *   loadingText?: ReactNode — optional swap label shown while loading.
 *                            Falls back to `children` if not provided.
 *
 * The spinner uses `motion-safe:animate-spin` so it respects the user's
 * `prefers-reduced-motion: reduce` setting (still visible as a static
 * icon for users who don't want animation).
 *
 * Pattern works with the existing icon convention:
 *   <Button loading={isPending} loadingText="Saving…">
 *     <SaveIcon />     ← gets swapped out for the spinner when loading
 *     Save
 *   </Button>
 *
 * The implementation walks `children` once to find the first ReactElement
 * (treated as the "leading icon") and replaces it with the spinner. Text
 * children fall through unchanged unless `loadingText` is supplied.
 *
 * KNOWN CONTRACT (both models flagged 2026-05-25): the child-replacement
 * heuristic assumes button structure of `<Icon /> + "text"`. If your
 * label is wrapped in an element (e.g., `<span>Save</span>`), it will
 * be treated as the "icon" and replaced by the spinner — text disappears.
 * For non-standard layouts, render the spinner manually instead of using
 * the `loading` prop, or restructure to put a leading icon first.
 */
import { Children, isValidElement } from "react"

export interface ButtonExtraProps {
  loading?: boolean
  loadingText?: ReactNode
}

function renderChildrenWithLoadingState(
  children: ReactNode,
  loading: boolean,
  loadingText: ReactNode,
): ReactNode {
  if (!loading) return children
  // When loading: replace the first ReactElement child (the icon) with
  // the spinner, and swap remaining text content with loadingText (if
  // provided). If there's no element child, just prepend the spinner.
  const childArray = Children.toArray(children)
  const firstElementIdx = childArray.findIndex((c) => isValidElement(c))
  const spinner = (
    <Loader2
      key="__loading-spinner"
      className="motion-safe:animate-spin"
      aria-hidden="true"
    />
  )
  if (firstElementIdx === -1) {
    return (
      <>
        {spinner}
        {loadingText ?? children}
      </>
    )
  }
  const replaced = [...childArray]
  replaced[firstElementIdx] = spinner
  if (loadingText !== undefined) {
    // Replace text-shaped (string/number) children with loadingText.
    // Preserve element children we didn't already swap.
    const out: ReactNode[] = []
    for (let i = 0; i < replaced.length; i++) {
      const c = replaced[i]
      if (i === firstElementIdx) {
        out.push(c)
      } else if (typeof c === "string" || typeof c === "number") {
        // Only emit loadingText once (the first time we hit a text child).
        if (!out.some((x) => x === loadingText)) out.push(loadingText)
      } else {
        out.push(c)
      }
    }
    return out
  }
  return replaced
}

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & ButtonExtraProps) {
  // Preserve caller-provided aria-busy when we're not loading — but force
  // it to true when we ARE loading. Avoids both leak directions:
  //   1. caller `aria-busy={false}` masking loading state (mask risk)
  //   2. our `loading=false` erasing caller's intentional `aria-busy={true}`
  //      for non-loading busy reasons (override risk)
  // Both ends of GPT cross-verify findings 2026-05-25.
  const { "aria-busy": callerAriaBusy, ...restProps } = props as typeof props & {
    "aria-busy"?: boolean | "true" | "false"
  }
  const effectiveAriaBusy = loading ? true : callerAriaBusy
  return (
    <ButtonPrimitive
      data-slot="button"
      {...restProps}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={effectiveAriaBusy}
    >
      {renderChildrenWithLoadingState(children, loading, loadingText)}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
