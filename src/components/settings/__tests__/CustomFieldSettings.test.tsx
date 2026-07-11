import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomFieldSettings } from "../CustomFieldSettings";

describe("CustomFieldSettings", () => {
  it("adds and saves a custom field definition", () => {
    const onUpdate = vi.fn();
    const addToast = vi.fn();

    render(
      <CustomFieldSettings customFields={[]} onUpdateCustomFields={onUpdate} addToast={addToast} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Add Field/i }));

    const labelInput = screen.getByPlaceholderText("Field name");
    fireEvent.change(labelInput, { target: { value: "Story Points" } });

    fireEvent.click(screen.getByRole("button", { name: /Done editing/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save Fields/i }));

    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        label: "Story Points",
        type: "text",
      }),
    ]);
    expect(addToast).toHaveBeenCalledWith("Saved 1 custom field", "success");
  });

  it("deletes a custom field", () => {
    const onUpdate = vi.fn();
    const addToast = vi.fn();

    render(
      <CustomFieldSettings
        customFields={[{ id: "field_1", label: "Owner", type: "text" }]}
        onUpdateCustomFields={onUpdate}
        addToast={addToast}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Delete Owner/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save Fields/i }));

    expect(onUpdate).toHaveBeenCalledWith([]);
  });
});
