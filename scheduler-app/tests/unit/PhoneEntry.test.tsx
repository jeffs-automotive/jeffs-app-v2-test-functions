import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneEntry } from "@/components/scheduler/PhoneEntry";

/**
 * RTL unit tests for the PhoneEntry rendering tool component.
 *
 * Per appointments_design.md §14:
 * - Component tests in jsdom; no AI SDK in the loop
 * - Test the input/output contract per §7.5
 */

describe("<PhoneEntry />", () => {
  it("normalizes a 10-digit US number to E.164 on submit", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/phone number/i);
    await userEvent.type(input, "6105550123");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({ phone: "+16105550123" });
  });

  it("accepts an 11-digit number starting with 1", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/phone number/i);
    await userEvent.type(input, "16105550123");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({ phone: "+16105550123" });
  });

  it("rejects a 9-digit input with an inline error and does NOT call onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/phone number/i);
    await userEvent.type(input, "610555012");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/10-digit/i);
  });

  it("rejects letters (digits-only after stripping)", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/phone number/i);
    await userEvent.type(input, "abc-def");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("formats input as (xxx) xxx-xxxx while typing", async () => {
    render(<PhoneEntry onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/phone number/i) as HTMLInputElement;
    await userEvent.type(input, "6105550123");
    expect(input.value).toBe("(610) 555-0123");
  });

  it("renders the optional reason text in the heading", () => {
    render(<PhoneEntry onSubmit={vi.fn()} reason="to look up your account" />);
    expect(
      screen.getByRole("heading", { level: 3 })
    ).toHaveTextContent(/to look up your account/i);
  });

  it("disables input + submit when `disabled` prop is set", () => {
    render(<PhoneEntry onSubmit={vi.fn()} disabled />);
    expect(screen.getByLabelText(/phone number/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("accepts user-typed dashes/parens (formatted input is the same value)", async () => {
    const onSubmit = vi.fn();
    render(<PhoneEntry onSubmit={onSubmit} />);

    const input = screen.getByLabelText(/phone number/i);
    await userEvent.type(input, "(610) 555-0123");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({ phone: "+16105550123" });
  });
});
