import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpInput } from "@/components/scheduler/OtpInput";

describe("<OtpInput />", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits the 6-digit code automatically when the customer fills all digits", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn();
    render(
      <OtpInput
        phone_last_four="0123"
        ttl_seconds={300}
        onSubmit={onSubmit}
      />
    );

    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(6);

    for (let i = 0; i < 6; i++) {
      await user.type(inputs[i]!, String(i));
    }

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ code: "012345" });
    });
  });

  it("shows the phone last 4 in the prompt copy", () => {
    render(
      <OtpInput phone_last_four="7777" ttl_seconds={300} onSubmit={vi.fn()} />
    );
    expect(
      screen.getByText(/sent a 6-digit code to your phone ending in/i)
    ).toBeInTheDocument();
    expect(screen.getByText("7777")).toBeInTheDocument();
  });

  it("shows a countdown that decrements each second", () => {
    render(
      <OtpInput phone_last_four="7777" ttl_seconds={120} onSubmit={vi.fn()} />
    );
    expect(screen.getByText(/2:00/)).toBeInTheDocument();

    vi.advanceTimersByTime(1000);
    expect(screen.getByText(/1:59/)).toBeInTheDocument();

    vi.advanceTimersByTime(60_000);
    expect(screen.getByText(/0:59/)).toBeInTheDocument();
  });

  it("disables inputs when ttl reaches zero (expired)", () => {
    render(
      <OtpInput phone_last_four="7777" ttl_seconds={2} onSubmit={vi.fn()} />
    );
    vi.advanceTimersByTime(2_500);

    const inputs = screen.getAllByRole("textbox");
    inputs.forEach((input) => {
      expect(input).toBeDisabled();
    });
    expect(screen.getByText(/code expired/i)).toBeInTheDocument();
  });

  it("strips non-digits — typing letters does NOT populate digit boxes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onSubmit = vi.fn();
    render(
      <OtpInput
        phone_last_four="0123"
        ttl_seconds={300}
        onSubmit={onSubmit}
      />
    );

    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(inputs[0]!, "a");
    expect(inputs[0]!.value).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("backspace on an empty digit moves focus to the previous digit", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <OtpInput phone_last_four="0123" ttl_seconds={300} onSubmit={vi.fn()} />
    );

    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    await user.type(inputs[0]!, "1");

    // Move focus to box #1, press backspace; should land on box #0
    inputs[1]!.focus();
    await user.keyboard("{Backspace}");
    expect(document.activeElement).toBe(inputs[0]);
  });
});
