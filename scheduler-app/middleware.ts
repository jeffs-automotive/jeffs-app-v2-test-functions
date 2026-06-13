/**
 * Next.js middleware — server-side session-cookie management.
 *
 * Per chat-design.md §C (Resume) lines 2952-2995: the scheduler MUST resume
 * via an HttpOnly cookie that survives device clears + private-tab boundaries
 * + the SMS-channel re-discovery flow. A localStorage-only flow would break
 * as soon as the customer clears their browser cache or hops to a new device
 * for the same session.
 *
 * What this middleware does:
 *   1. On EVERY page navigation under /, /book (and any future scheduler
 *      sub-routes), look for the `sched-chat-id` HttpOnly cookie.
 *   2. If missing, set a fresh UUID v4 cookie with:
 *        - HttpOnly: true       (JS can't read it — survives XSS)
 *        - SameSite: 'lax'      (set on same-site nav; not on cross-site)
 *        - Secure: prod-only    (we still need the cookie locally)
 *        - Path: '/'            (visible to all scheduler routes)
 *        - Max-Age: 30 days     (long enough for a customer to return)
 *   3. The page Server Component (app/page.tsx, app/book/page.tsx) reads the
 *      cookie via next/headers, then BookPageShell → hydrateSession hydrates
 *      the wizard's current_step from the customer_chat_sessions row.
 *
 * What this middleware does NOT do:
 *   - Validate the UUID against any DB row. hydrateSession's
 *     ensureSessionExists upserts the customer_chat_sessions row on first
 *     load; the cookie value can be ANY uuid v4 and the DB lookup will
 *     either find an existing session or create one.
 *   - Issue a cross-device-resume token (phone-keyed). That's Phase 2 per
 *     chat-design.md line 413.
 *   - Trigger middleware on API routes (matcher excludes /api/*).
 */

import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

const COOKIE_NAME = "sched-chat-id";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function middleware(req: NextRequest) {
  try {
    const existing = req.cookies.get(COOKIE_NAME)?.value;

    if (existing && UUID_V4_RE.test(existing)) {
      // Already have a valid cookie — pass through untouched.
      return NextResponse.next();
    }

    // Issue a fresh chat-id cookie.
    const fresh = crypto.randomUUID();
    const res = NextResponse.next();
    res.cookies.set({
      name: COOKIE_NAME,
      value: fresh,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: THIRTY_DAYS_SECONDS,
    });
    return res;
  } catch (e) {
    // Defense in depth (R6-A NICE 2026-05-16): instrumentation.ts's
    // onRequestError catches middleware throws, but pin a Sentry capture
    // here too with the explicit surface so triage doesn't have to infer
    // "middleware" from request metadata. Always pass through on error
    // so a Sentry/crypto hiccup doesn't 500 every page navigation.
    Sentry.captureException(e, {
      tags: { surface: "scheduler_middleware_cookie_set" },
      level: "warning",
    });
    return NextResponse.next();
  }
}

/**
 * Match the scheduler page routes only. Exclude:
 *   - /api/*  (route handlers manage their own auth; /api/scheduler/
 *              mark-abandoned reads chat_id from the request body + HMAC,
 *              not the cookie)
 *   - /_next  (Next.js internal)
 *   - /favicon.ico, /robots.txt, image / static assets
 *   - /monitoring (Sentry tunnel route configured in next.config.ts)
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - API routes (api/*)
     * - Next.js internals (_next/static, _next/image)
     * - Favicon + static files
     * - Sentry tunnel (/monitoring)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|monitoring).*)",
  ],
};
