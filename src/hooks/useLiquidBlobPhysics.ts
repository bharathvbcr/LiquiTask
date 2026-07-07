import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent, type Ref } from "react";

interface BlobParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface MotionSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const REST_Y = 0.18;
const GRAVITY = 0.0018;
const SETTLE_EPSILON = 0.00035;

function integrate(p: BlobParticle, ax: number, ay: number, damping: number) {
  p.vx = (p.vx + ax) * damping;
  p.vy = (p.vy + ay) * damping;
  p.x += p.vx;
  p.y += p.vy;
}

function isSettled(primary: BlobParticle, secondary: BlobParticle, droplet: BlobParticle) {
  return (
    Math.hypot(primary.vx, primary.vy) < SETTLE_EPSILON &&
    Math.hypot(secondary.vx, secondary.vy) < SETTLE_EPSILON &&
    Math.hypot(droplet.vx, droplet.vy) < SETTLE_EPSILON &&
    Math.abs(primary.x) < SETTLE_EPSILON &&
    Math.abs(primary.y - REST_Y) < SETTLE_EPSILON
  );
}

export function useLiquidBlobPhysics() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const animatingRef = useRef(false);
  const interactingRef = useRef(false);
  const capturingRef = useRef(false);

  const pointerRef = useRef<MotionSample>({ x: 0.5, y: 0.5, vx: 0, vy: 0 });
  const containerRef = useRef<MotionSample>({ x: 0, y: 0, vx: 0, vy: 0 });
  const primaryRef = useRef<BlobParticle>({ x: 0, y: REST_Y, vx: 0, vy: 0 });
  const secondaryRef = useRef<BlobParticle>({ x: 0, y: REST_Y + 0.04, vx: 0, vy: 0 });
  const dropletRef = useRef<BlobParticle>({ x: 0, y: REST_Y + 0.12, vx: 0, vy: 0 });

  const sampleContainerMotion = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const prev = containerRef.current;
    const vx = (rect.left - prev.x) / rect.width;
    const vy = (rect.top - prev.y) / rect.height;
    containerRef.current = { x: rect.left, y: rect.top, vx, vy };
  }, []);

  const applyVars = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;

    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    const droplet = dropletRef.current;
    const container = containerRef.current;
    const speed = Math.hypot(primary.vx, primary.vy);
    const accel = Math.hypot(container.vx + pointerRef.current.vx, container.vy + pointerRef.current.vy);

    const squashX = 1 + Math.min(speed * 14 + Math.abs(primary.vx) * 6, 0.38) - Math.min(Math.abs(primary.vy) * 4, 0.12);
    const squashY = 1 + Math.min(Math.abs(primary.vy) * 10 + 0.06, 0.32) - Math.min(Math.abs(primary.vx) * 5, 0.14);
    const tilt = Math.max(Math.min(primary.vx * 220 + container.vx * 180, 28), -28);
    const surfaceTilt = Math.max(Math.min(secondary.vx * 260, 22), -22);

    const r1 = 44 + primary.vy * 120 + primary.vx * 40;
    const r2 = 56 - primary.vy * 80 + primary.vx * 50;
    const r3 = 52 + primary.vx * 60 - primary.vy * 40;
    const r4 = 48 - primary.vx * 70 - primary.vy * 30;

    el.style.setProperty("--blob-x", `${primary.x * 100}%`);
    el.style.setProperty("--blob-y", `${primary.y * 100}%`);
    el.style.setProperty("--blob-x2", `${secondary.x * 100}%`);
    el.style.setProperty("--blob-y2", `${secondary.y * 100}%`);
    el.style.setProperty("--blob-drop-x", `${droplet.x * 100}%`);
    el.style.setProperty("--blob-drop-y", `${droplet.y * 100}%`);
    el.style.setProperty("--blob-scale-x", `${squashX.toFixed(3)}`);
    el.style.setProperty("--blob-scale-y", `${squashY.toFixed(3)}`);
    el.style.setProperty("--blob-tilt", `${tilt.toFixed(2)}deg`);
    el.style.setProperty("--blob-surface-tilt", `${surfaceTilt.toFixed(2)}deg`);
    el.style.setProperty("--blob-speed", `${Math.min(speed * 28 + accel * 18, 1).toFixed(3)}`);
    el.style.setProperty("--blob-r1", `${Math.max(30, Math.min(70, r1)).toFixed(1)}%`);
    el.style.setProperty("--blob-r2", `${Math.max(30, Math.min(70, r2)).toFixed(1)}%`);
    el.style.setProperty("--blob-r3", `${Math.max(30, Math.min(70, r3)).toFixed(1)}%`);
    el.style.setProperty("--blob-r4", `${Math.max(30, Math.min(70, r4)).toFixed(1)}%`);
  }, []);

  const tick = useCallback(() => {
    sampleContainerMotion();

    const pointer = pointerRef.current;
    const container = containerRef.current;
    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    const droplet = dropletRef.current;

    const active = interactingRef.current;
    const damping = active ? 0.965 : 0.91;
    const sloshGain = active ? 0.085 : 0.055;

    const combinedVx = pointer.vx + container.vx;
    const combinedVy = pointer.vy + container.vy;
    const tiltX = active ? (pointer.x - 0.5) * 0.22 : 0;
    const tiltY = active ? REST_Y + (pointer.y - 0.55) * 0.12 : REST_Y;

    const ax =
      -primary.x * 0.014 +
      (tiltX - primary.x) * (active ? 0.006 : 0.018) -
      combinedVx * sloshGain * 12;
    const ay =
      GRAVITY +
      (tiltY - primary.y) * (active ? 0.005 : 0.016) -
      combinedVy * sloshGain * 10 +
      Math.max(combinedVy, 0) * 0.04;

    integrate(primary, ax, ay, damping);

    const secAx =
      (primary.x * 1.35 - secondary.x) * 0.028 -
      (secondary.vx - primary.vx * 0.6) * 0.08 -
      combinedVx * sloshGain * 18;
    const secAy =
      GRAVITY * 1.4 +
      (primary.y + 0.05 - secondary.y) * 0.022 -
      combinedVy * sloshGain * 14;
    integrate(secondary, secAx, secAy, active ? 0.955 : 0.895);

    const detach = Math.hypot(combinedVx, combinedVy);
    const dropAx =
      (primary.x - droplet.x) * 0.012 -
      combinedVx * (0.06 + Math.min(detach * 20, 0.35)) +
      primary.vx * 0.35;
    const dropAy =
      GRAVITY * 2.2 +
      (primary.y + 0.1 - droplet.y) * 0.015 -
      combinedVy * (0.05 + Math.min(detach * 16, 0.28)) +
      Math.max(primary.vy, 0) * 0.25;
    integrate(droplet, dropAx, dropAy, active ? 0.94 : 0.86);

    applyVars();

    if (!interactingRef.current && isSettled(primary, secondary, droplet)) {
      animatingRef.current = false;
      rafRef.current = null;
      rootRef.current?.classList.remove("liquid-card--blob-active");
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [applyVars, sampleContainerMotion]);

  const startLoop = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    sampleContainerMotion();
    if (animatingRef.current) return;
    animatingRef.current = true;
    rootRef.current?.classList.add("liquid-card--blob-active");
    rafRef.current = requestAnimationFrame(tick);
  }, [sampleContainerMotion, tick]);

  const updatePointer = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const nx = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const ny = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    const prev = pointerRef.current;
    pointerRef.current = { x: nx, y: ny, vx: nx - prev.x, vy: ny - prev.y };
  }, []);

  const releaseInteraction = useCallback(() => {
    interactingRef.current = false;
    pointerRef.current = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    startLoop();
  }, [startLoop]);

  const onPointerEnter = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      interactingRef.current = true;
      updatePointer(event.clientX, event.clientY);
      startLoop();
    },
    [startLoop, updatePointer],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      interactingRef.current = true;
      updatePointer(event.clientX, event.clientY);
      startLoop();
    },
    [startLoop, updatePointer],
  );

  const onPointerLeave = useCallback(() => {
    if (capturingRef.current) return;
    releaseInteraction();
  }, [releaseInteraction]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      capturingRef.current = true;
      interactingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      updatePointer(event.clientX, event.clientY);
      startLoop();
    },
    [startLoop, updatePointer],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      capturingRef.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      releaseInteraction();
    },
    [releaseInteraction],
  );

  useEffect(() => {
    applyVars();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [applyVars]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (media.matches && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        animatingRef.current = false;
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (node) {
        const rect = node.getBoundingClientRect();
        containerRef.current = { x: rect.left, y: rect.top, vx: 0, vy: 0 };
      }
      applyVars();
    },
    [applyVars],
  );

  return {
    setRootRef,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onPointerDown,
    onPointerUp,
  };
}

export function mergeDivRefs<T extends HTMLDivElement>(
  ...refs: Array<Ref<T> | undefined | ((node: T | null) => void)>
) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") {
        (ref as MutableRefObject<T | null>).current = node;
      }
    }
  };
}
