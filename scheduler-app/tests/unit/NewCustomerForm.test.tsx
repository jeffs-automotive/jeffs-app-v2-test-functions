import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewCustomerForm } from "@/components/scheduler/NewCustomerForm";

describe("<NewCustomerForm />", () => {
  it("submits required fields (full mode)", async () => {
    const onSubmit = vi.fn();
    render(<NewCustomerForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/first name/i), "Anna");
    await userEvent.type(screen.getByPlaceholderText(/last name/i), "Lee");
    await userEvent.type(screen.getByPlaceholderText("Year"), "2022");
    await userEvent.type(screen.getByPlaceholderText("Make"), "Subaru");
    await userEvent.type(screen.getByPlaceholderText("Model"), "Outback");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      first_name: "Anna",
      last_name: "Lee",
      email: undefined,
      vehicle: {
        year: 2022,
        make: "Subaru",
        model: "Outback",
        sub_model: undefined,
        vin: undefined,
        license_plate: undefined,
        state: undefined,
      },
    });
  });

  it("submits optional fields when filled", async () => {
    const onSubmit = vi.fn();
    render(<NewCustomerForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/first name/i), "Anna");
    await userEvent.type(screen.getByPlaceholderText(/last name/i), "Lee");
    await userEvent.type(screen.getByPlaceholderText(/email/i), "anna@example.com");
    await userEvent.type(screen.getByPlaceholderText("Year"), "2022");
    await userEvent.type(screen.getByPlaceholderText("Make"), "Subaru");
    await userEvent.type(screen.getByPlaceholderText("Model"), "Outback");

    // Open the optional details panel
    await userEvent.click(screen.getByText(/more details/i));
    await userEvent.type(screen.getByPlaceholderText(/trim/i), "Limited");
    await userEvent.type(screen.getByPlaceholderText("VIN"), "JF2GTABC9NH123456");
    await userEvent.type(screen.getByPlaceholderText(/license plate/i), "ABC 123");
    await userEvent.type(screen.getByPlaceholderText(/^State$/), "PA");

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      first_name: "Anna",
      last_name: "Lee",
      email: "anna@example.com",
      vehicle: {
        year: 2022,
        make: "Subaru",
        model: "Outback",
        sub_model: "Limited",
        vin: "JF2GTABC9NH123456",
        license_plate: "ABC 123",
        state: "PA",
      },
    });
  });

  it("blocks submit when first name is missing", async () => {
    const onSubmit = vi.fn();
    render(<NewCustomerForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/last name/i), "Lee");
    await userEvent.type(screen.getByPlaceholderText("Year"), "2022");
    await userEvent.type(screen.getByPlaceholderText("Make"), "Subaru");
    await userEvent.type(screen.getByPlaceholderText("Model"), "Outback");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/first name is required/i);
  });

  it("blocks submit when year is out of range", async () => {
    const onSubmit = vi.fn();
    render(<NewCustomerForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/first name/i), "Anna");
    await userEvent.type(screen.getByPlaceholderText(/last name/i), "Lee");
    await userEvent.type(screen.getByPlaceholderText("Year"), "1950");
    await userEvent.type(screen.getByPlaceholderText("Make"), "Ford");
    await userEvent.type(screen.getByPlaceholderText("Model"), "Model T");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/year must be between/i);
  });

  it("vehicle-only mode hides customer fields", () => {
    render(<NewCustomerForm mode="vehicle-only" onSubmit={vi.fn()} />);

    expect(screen.queryByPlaceholderText(/first name/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/last name/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Year")).toBeInTheDocument();
  });

  it("uppercases VIN and plate as the user types", async () => {
    render(<NewCustomerForm onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByText(/more details/i));

    const vin = screen.getByPlaceholderText("VIN") as HTMLInputElement;
    await userEvent.type(vin, "abc123");
    expect(vin.value).toBe("ABC123");
  });

  it("pre-fills from collected_so_far prop", () => {
    render(
      <NewCustomerForm
        onSubmit={vi.fn()}
        collected_so_far={{
          first_name: "Bob",
          last_name: "Smith",
          vehicle: { year: 2019, make: "Honda", model: "Civic" },
        }}
      />
    );

    expect(
      (screen.getByPlaceholderText(/first name/i) as HTMLInputElement).value
    ).toBe("Bob");
    expect(
      (screen.getByPlaceholderText(/last name/i) as HTMLInputElement).value
    ).toBe("Smith");
    expect((screen.getByPlaceholderText("Year") as HTMLInputElement).value).toBe(
      "2019"
    );
  });
});
