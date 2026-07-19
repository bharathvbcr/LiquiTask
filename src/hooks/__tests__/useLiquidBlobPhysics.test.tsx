import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiquidBlobPhysics } from "../useLiquidBlobPhysics";

// jsdom has no PointerEvent — polyfill it as a MouseEvent subclass so
// fireEvent.pointer* actually carries clientX/clientY into the handlers.
if (typeof window.PointerEvent !== "function") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEvent }).PointerEvent =
    PointerEventPolyfill as unknown as typeof PointerEvent;
}

/**
 * Drives the hook's rAF loop manually so the fluid simulation can be stepped
 * deterministically — no dependence on real timers or frame scheduling.
 */
let rafQueue: Map<number, (time: number) => void>;
let rafSeq: number;

const runFrames = (count: number, startTime = 0, stepMs = 16.7) => {
  let time = startTime;
  for (let i = 0; i < count; i++) {
    if (rafQueue.size === 0) break;
    time += stepMs;
    const callbacks = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of callbacks) cb(time);
  }
  return time;
};

const mockRect = (el: HTMLElement) => {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 200,
      height: 120,
      right: 200,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
};

const Probe = () => {
  const blob = useLiquidBlobPhysics();
  return (
    <div
      data-testid="card"
      className="liquid-card"
      ref={blob.setRootRef}
      onPointerEnter={blob.onPointerEnter}
      onPointerMove={blob.onPointerMove}
      onPointerLeave={blob.onPointerLeave}
      onPointerDown={blob.onPointerDown}
      onPointerUp={blob.onPointerUp}
    />
  );
};

const liquidVar = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);
const liquidNum = (el: HTMLElement, name: string) => Number.parseFloat(liquidVar(el, name));

describe("useLiquidBlobPhysics", () => {
  beforeEach(() => {
    rafQueue = new Map();
    rafSeq = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) => {
      rafSeq += 1;
      rafQueue.set(rafSeq, cb);
      return rafSeq;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes the liquid CSS variables at rest on mount", () => {
    render(<Probe />);
    const card = screen.getByTestId("card");

    expect(liquidVar(card, "--blob-x")).toBe("0.00%");
    expect(liquidVar(card, "--blob-y")).toBe("18.00%");
    expect(liquidVar(card, "--blob-pulse")).toBe("0.000");
    expect(liquidVar(card, "--blob-stretch")).toBe("0.000");
    expect(liquidVar(card, "--blob-tilt")).toBe("0.00deg");
    expect(liquidNum(card, "--blob-drop-sx")).toBeCloseTo(0.7, 3);
    expect(liquidNum(card, "--blob-drop-sy")).toBeCloseTo(0.7, 3);
    expect(card.classList.contains("liquid-card--blob-active")).toBe(false);
    expect(rafQueue.size).toBe(0);
  });

  it("starts sloshing on pointer enter and reports fluid state via CSS vars", () => {
    render(<Probe />);
    const card = screen.getByTestId("card");
    mockRect(card);

    fireEvent.pointerEnter(card, { clientX: 190, clientY: 12 });
    expect(card.classList.contains("liquid-card--blob-active")).toBe(true);
    expect(rafQueue.size).toBe(1);

    runFrames(30);

    // The liquid is moving: speed register is up and stretch/pulse are valid.
    expect(liquidNum(card, "--blob-speed")).toBeGreaterThan(0.02);
    expect(liquidNum(card, "--blob-stretch")).toBeGreaterThanOrEqual(0);
    expect(liquidNum(card, "--blob-pulse")).toBeGreaterThanOrEqual(0);
    expect(liquidNum(card, "--blob-drop-sx")).toBeGreaterThan(0);
    expect(Number.isFinite(liquidNum(card, "--blob-stretch-angle"))).toBe(true);
    // The surface film and droplet follow the main body.
    expect(liquidVar(card, "--blob-x2")).not.toBe("");
    expect(liquidVar(card, "--blob-drop-y")).not.toBe("");
  });

  it("dents the surface with a ripple pulse on pointer down", () => {
    render(<Probe />);
    const card = screen.getByTestId("card");
    mockRect(card);

    fireEvent.pointerEnter(card, { clientX: 100, clientY: 60 });
    runFrames(5);
    fireEvent.pointerDown(card, { clientX: 100, clientY: 60, pointerId: 1 });
    runFrames(2);

    expect(liquidNum(card, "--blob-pulse")).toBeGreaterThan(0.2);

    fireEvent.pointerUp(card, { clientX: 100, clientY: 60, pointerId: 1 });
  });

  it("flings the droplet on hard shakes, then settles back to rest and sleeps", () => {
    render(<Probe />);
    const card = screen.getByTestId("card");
    mockRect(card);

    fireEvent.pointerEnter(card, { clientX: 30, clientY: 60 });
    // Violent alternating swipe — enough flow to detach the droplet.
    for (let i = 0; i < 8; i++) {
      fireEvent.pointerMove(card, { clientX: i % 2 === 0 ? 190 : 10, clientY: 60 });
      runFrames(2, i * 40);
    }
    expect(liquidNum(card, "--blob-speed")).toBeGreaterThan(0.3);

    fireEvent.pointerLeave(card);
    runFrames(900, 400); // ~15 simulated seconds — plenty of time to settle

    // Loop stopped, class removed, and everything is back at rest.
    expect(rafQueue.size).toBe(0);
    expect(card.classList.contains("liquid-card--blob-active")).toBe(false);
    expect(liquidVar(card, "--blob-x")).toBe("0.00%");
    expect(liquidVar(card, "--blob-y")).toBe("18.00%");
    expect(liquidNum(card, "--blob-pulse")).toBeLessThan(0.02);
    // Droplet tucked back into the pool at the anchor point (rest + 10%).
    expect(liquidVar(card, "--blob-drop-y")).toBe("28.00%");
  });

  it("does not animate when the user prefers reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );

    render(<Probe />);
    const card = screen.getByTestId("card");
    mockRect(card);

    fireEvent.pointerEnter(card, { clientX: 150, clientY: 40 });
    runFrames(10);

    expect(rafQueue.size).toBe(0);
    expect(card.classList.contains("liquid-card--blob-active")).toBe(false);
  });

  it("cancels the animation loop on unmount", () => {
    const { unmount } = render(<Probe />);
    const card = screen.getByTestId("card");
    mockRect(card);

    fireEvent.pointerEnter(card, { clientX: 150, clientY: 40 });
    expect(rafQueue.size).toBe(1);

    unmount();
    expect(rafQueue.size).toBe(0);
  });
});

