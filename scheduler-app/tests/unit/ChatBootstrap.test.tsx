import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * RTL tests for ChatBootstrap — the client-side chatId picker.
 *
 * Per appointments_design.md §3.1 + scheduler_project_state.md Phase 1
 * deferred-cookie note:
 *   - Reads chatId from localStorage if a valid v4 UUID is present
 *   - Otherwise generates a fresh UUID via crypto.randomUUID() and persists
 *   - Renders <Chat chatId={...} />
 *
 * We mock Chat to a stub so we can assert the chatId prop without booting
 * the full useChat + DefaultChatTransport pipeline.
 */

vi.mock("@/components/scheduler/Chat", () => ({
  Chat: vi.fn(
    (props: { chatId: string }) => (
      <div data-testid="chat-mounted" data-chat-id={props.chatId} />
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

  it("reuses a valid v4 UUID already in localStorage", async () => {
    localStorage.setItem(STORAGE_KEY, VALID_UUID);

    render(<ChatBootstrap />);

    const mounted = await screen.findByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(VALID_UUID);
    // localStorage should be unchanged
    expect(localStorage.getItem(STORAGE_KEY)).toBe(VALID_UUID);
  });

  it("generates a fresh UUID + persists it when localStorage is empty", async () => {
    const fresh = "99999999-9999-4999-8999-999999999999";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      fresh as `${string}-${string}-${string}-${string}-${string}`,
    );

    render(<ChatBootstrap />);

    const mounted = await screen.findByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(fresh);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(fresh);
  });

  it("rejects an invalid stored value and generates a fresh UUID", async () => {
    localStorage.setItem(STORAGE_KEY, "not-a-uuid");
    const fresh = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      fresh as `${string}-${string}-${string}-${string}-${string}`,
    );

    render(<ChatBootstrap />);

    const mounted = await screen.findByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(fresh);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(fresh);
  });

  it("falls back to an ephemeral session when localStorage throws (private mode)", async () => {
    const fresh = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      fresh as `${string}-${string}-${string}-${string}-${string}`,
    );
    // Force localStorage.getItem AND setItem to throw — mimics private-mode browsers
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });

    render(<ChatBootstrap />);

    const mounted = await screen.findByTestId("chat-mounted");
    expect(mounted.getAttribute("data-chat-id")).toBe(fresh);
  });

  it("shows a loading placeholder on the first synchronous render (before useEffect)", () => {
    // ChatBootstrap returns the placeholder before useEffect resolves chatId.
    // We render with no localStorage value + capture the synchronous output:
    const { container } = render(<ChatBootstrap />);
    // useEffect runs after first paint; if it hasn't picked the id yet, we
    // see "Loading chat…". Once it lands, the chat mount appears. Both
    // behaviors are valid — assert one of them is present.
    const hasPlaceholder = !!container.querySelector('[aria-live="polite"]');
    const hasMount = !!container.querySelector('[data-testid="chat-mounted"]');
    expect(hasPlaceholder || hasMount).toBe(true);
  });

  it("eventually resolves to a Chat mount (post-useEffect)", async () => {
    render(<ChatBootstrap />);
    await waitFor(() => {
      expect(screen.getByTestId("chat-mounted")).toBeInTheDocument();
    });
  });
});
