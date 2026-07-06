import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Popover } from "../Popover";

describe("Popover", () => {
  it("renders trigger and portals content to document.body when open", () => {
    render(
      <Popover
        open
        onOpenChange={() => {}}
        trigger={<button type="button">Open</button>}
      >
        <div>Popover content</div>
      </Popover>,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
    const content = screen.getByText("Popover content");
    const portalWrapper = content.parentElement;
    expect(portalWrapper).toHaveClass("fixed");
    expect(document.body.contains(content)).toBe(true);
  });

  it("does not render portal content when closed", () => {
    render(
      <Popover
        open={false}
        onOpenChange={() => {}}
        trigger={<button type="button">Open</button>}
      >
        <div>Popover content</div>
      </Popover>,
    );

    expect(screen.queryByText("Popover content")).not.toBeInTheDocument();
  });

  it("calls onOpenChange(false) on outside pointerdown", () => {
    const onOpenChange = vi.fn();
    render(
      <div data-testid="outside">
        <Popover
          open
          onOpenChange={onOpenChange}
          trigger={<button type="button">Open</button>}
        >
          <div>Popover content</div>
        </Popover>
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not close when pointerdown is on trigger or content", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover
        open
        onOpenChange={onOpenChange}
        trigger={<button type="button">Open</button>}
      >
        <button type="button">Inside</button>
      </Popover>,
    );

    fireEvent.pointerDown(screen.getByText("Open"));
    fireEvent.pointerDown(screen.getByText("Inside"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("calls onOpenChange(false) on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover
        open
        onOpenChange={onOpenChange}
        trigger={<button type="button">Open</button>}
      >
        <div>Popover content</div>
      </Popover>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides content until positioned to avoid flash", () => {
    render(
      <Popover
        open
        onOpenChange={() => {}}
        trigger={<button type="button">Open</button>}
      >
        <div>Popover content</div>
      </Popover>,
    );

    const wrapper = screen.getByText("Popover content").parentElement;
    expect(wrapper).toHaveClass("opacity-100");
  });

  it("stops pointerdown propagation on trigger wrapper and content", () => {
    const outerHandler = vi.fn();
    render(
      <div onPointerDown={outerHandler}>
        <Popover
          open
          onOpenChange={() => {}}
          trigger={<button type="button">Open</button>}
        >
          <div>Popover content</div>
        </Popover>
      </div>,
    );

    fireEvent.pointerDown(screen.getByText("Open"));
    fireEvent.pointerDown(screen.getByText("Popover content"));
    expect(outerHandler).not.toHaveBeenCalled();
  });
});
