import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { interpolate } from "@/lib/scheduler/wizard/card-copy";

describe("interpolate", () => {
  it("substitutes a string value for a token", () => {
    const { container } = render(
      <div>{interpolate("Hi, I'm {{agent_name}} 👋", { agent_name: "Jeff" })}</div>,
    );
    expect(container).toHaveTextContent("Hi, I'm Jeff 👋");
  });

  it("renders a node value (e.g. a tel: link) for a token", () => {
    render(
      <div>
        {interpolate("Call {{shop_phone}} today", {
          shop_phone: <a href="tel:6102536565">(610) 253-6565</a>,
        })}
      </div>,
    );
    const link = screen.getByRole("link", { name: /\(610\) 253-6565/ });
    expect(link).toHaveAttribute("href", "tel:6102536565");
  });

  it("leaves an unknown token literal (admin save-validation is the real guard)", () => {
    const { container } = render(<div>{interpolate("Hello {{bogus}}", {})}</div>);
    expect(container).toHaveTextContent("Hello {{bogus}}");
  });

  it("returns a purely static template unchanged", () => {
    const { container } = render(
      <div>{interpolate("Have you been to our shop before?")}</div>,
    );
    expect(container).toHaveTextContent("Have you been to our shop before?");
  });
});
