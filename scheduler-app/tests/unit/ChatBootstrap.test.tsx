import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * RTL tests for ChatBootstrap — cookie-resume rewrite 2026-05-13.
 *
 * Pre-rewrite: ChatBootstrap was responsible for picking the chatId
 * (read localStorage → fall back to crypto.randomUUID() → persist).
 * Post-rewrite: ChatBootstrap is dumb. The page Server Component reads
 * the `sched-chat-id` cookie (set by middleware) + loadChat(...) and
 * passes both via props. ChatBootstrap just renders <Chat /> with those
 * props and syncs localStorage as a BACKUP pointer.
 *
 * We mock Chat to a stub so we can assert the passed-through props
 * without booting the full useChat + DefaultChatTransport pipeline.
 */

vi.mock("@/components/scheduler/Chat", () => ({
  Chat: vi.fn(
    (props: { chatId: string; initialStep: string | null }) => (
      <div
        data-testid="chat-mounted"
        data-chat-id={props.chatId}
        data-initial-step={props.initialStep ?? ""}
      />
    ),
  ),
}));

// Import after vi.mock so the mock is applied
import { ChatBootstrap } from "@/components/scheduler/ChatBootstrap";

const STORAGE_KEY = "jeffs-scheduler-chat-id";
const VALID_UUID = "12345678-1234-4567-89ab-123456789abc";

describe("<ChatBootstrap />", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Chat with the server-provided chatId + initialMessages", () => {
    render(
      <ChatBootstrap
        chatId={VALID_UUID}
        initialMessages={[]}
        initialStep={null}
      />,
    );

    const mounted = screen.getByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(VALID_UUID);
  });

  it("passes the server-hydrated initialStep through to Chat", () => {
    render(
      <ChatBootstrap
        chatId={VALID_UUID}
        initialMessages={[]}
        initialStep="phone_name"
      />,
    );

    const mounted = screen.getByTestId("chat-mounted");
    expect(mounted.getAttribute("data-initial-step")).toBe("phone_name");
  });

  it("syncs chatId to localStorage as a backup pointer", () => {
    render(
      <ChatBootstrap
        chatId={VALID_UUID}
        initialMessages={[]}
        initialStep={null}
      />,
    );

    expect(localStorage.getItem(STORAGE_KEY)).toBe(VALID_UUID);
  });

  it("works even when localStorage is unavailable (private mode)", () => {
    // Force localStorage.setItem to throw — mimics private-mode browsers.
    // The component should still render Chat (the cookie + DB row are the
    // real persistence; localStorage is just a backup).
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });

    render(
      <ChatBootstrap
        chatId={VALID_UUID}
        initialMessages={[]}
        initialStep={null}
      />,
    );

    const mounted = screen.getByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(VALID_UUID);
  });

  it("updates localStorage when a new chatId prop arrives (cookie roll)", () => {
    const { rerender } = render(
      <ChatBootstrap
        chatId={VALID_UUID}
        initialMessages={[]}
        initialStep={null}
      />,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(VALID_UUID);

    const secondUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    rerender(
      <ChatBootstrap
        chatId={secondUuid}
        initialMessages={[]}
        initialStep={null}
      />,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(secondUuid);
  });
});
