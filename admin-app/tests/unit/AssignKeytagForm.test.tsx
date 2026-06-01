import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the Server Action module (it's "use server" + pulls requireAdmin/orchestrator
// client = server-only) and sonner (avoids needing a mounted <Toaster>). This is the
// reusable action-mock pattern for the other useActionState keytag forms.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/keytag/assign-keytag", () => ({ assignKeytagAction: vi.fn() }));

import { AssignKeytagForm } from "@/components/keytag/AssignKeytagForm";
import {
  assignKeytagAction,
  type AssignKeytagState,
} from "@/actions/keytag/assign-keytag";

const mockAction = vi.mocked(assignKeytagAction);

describe("AssignKeytagForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAction.mockResolvedValue({ kind: "idle" });
  });

  it("renders the assign form (RO#, color, tag#) + the auto-assign hint", () => {
    render(<AssignKeytagForm />);
    expect(screen.getByLabelText(/RO #/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Color/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tag #/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^assign$/i })).toBeInTheDocument();
    expect(screen.getByText(/auto-assign the next tag/i)).toBeInTheDocument();
  });

  it("opens the Pattern A ConfirmationDialog when the action returns needs_confirmation", async () => {
    const state: AssignKeytagState = {
      kind: "needs_confirmation",
      args: { ro_number: 152222, color: "red", tag_number: 4 },
      confirmation: {
        token_id: "11111111-1111-1111-1111-111111111111",
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        action_kind: "force_assign",
        scope_summary: "Force-assign R4 to RO 152222",
      },
      message: "Confirm to force-assign R4.",
    };
    mockAction.mockResolvedValue(state);

    render(<AssignKeytagForm />);
    await userEvent.type(screen.getByLabelText(/RO #/i), "152222");
    await userEvent.click(screen.getByRole("button", { name: /^assign$/i }));

    // The action's needs_confirmation state must drive the dialog open with the scope_summary.
    expect(await screen.findByText(/Force-assign R4 to RO 152222/)).toBeInTheDocument();
    expect(mockAction).toHaveBeenCalled();
  });

  it("shows a validation error message when the action returns validation_error", async () => {
    mockAction.mockResolvedValue({
      kind: "validation_error",
      message: "Specify BOTH color and tag number to force-assign, or NEITHER for auto-assign.",
    });

    render(<AssignKeytagForm />);
    await userEvent.type(screen.getByLabelText(/RO #/i), "152222");
    await userEvent.click(screen.getByRole("button", { name: /^assign$/i }));

    expect(await screen.findByText(/Specify BOTH color and tag number/i)).toBeInTheDocument();
  });
});
