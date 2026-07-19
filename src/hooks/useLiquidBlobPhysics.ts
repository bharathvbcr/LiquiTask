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

interface Bounds {
  x: number;
  top: number;
  bottom: number;
}

/**
 * Liquid model constants. Positions are container-normalized offsets from the
 * card's reference point (1.0 = the card's full width/height), velocities are
 * units/second and accelerations units/second². The integrator runs on a fixed
 * 120 Hz timestep so the fluid feels identical on 60/90/120 Hz displays.
 */
const REST_Y = 0.18;
const PHYSICS_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 5;
const MAX_FRAME_DT = 0.05;

const SPRING_ACTIVE = 3.6; // gentle lean toward the pointer while interacting
const SPRING_IDLE = 18; // brisk spring home once released

const SLOSH_PRIMARY = 26; // how hard hand motion pumps the main body
const SLOSH_SURFACE = 40; // the surface film sloshes harder than the core
const SLOSH_DROPLET = 52; // droplets get flung the hardest

const DRAG_LINEAR_PRIMARY = 3.2; // viscous drag — linear term (per second)…
const DRAG_QUAD_PRIMARY = 5.2; // …and turbulent term: fast sloshes bleed speed quickly
const DRAG_LINEAR_SURFACE = 2.4;
const DRAG_QUAD_SURFACE = 4;
const DRAG_LINEAR_DROPLET = 1.1;
const DRAG_QUAD_DROPLET = 3.2;

const SURFACE_SPRING = 52; // cohesion between the surface film and the main body
const SURFACE_COUPLING = 7.5;
const SURFACE_GRAVITY = 7;

const DROPLET_GRAVITY = 26; // ballistic while airborne
const DROPLET_GRAVITY_NEAR = 4; // surface tension dominates next to the pool
const DROPLET_COHESION = 90; // pull home once inside the surface-tension zone
const DROPLET_TETHER = 0.16; // ligament length before it snaps back
const DROPLET_TETHER_SPRING = 95;
const DROPLET_TETHER_DAMP = 7;
const DROPLET_GLUE = 320; // spring holding a merged droplet in the pool
const DROPLET_GLUE_DAMP = 18;
const MERGE_RADIUS = 0.05;
const MERGE_SPEED = 0.95;
const DETACH_FLOW = 1.15;

const BOUNDS_PRIMARY: Bounds = { x: 0.42, top: -0.32, bottom: 0.55 };
const BOUNDS_SURFACE: Bounds = { x: 0.5, top: -0.38, bottom: 0.62 };
const BOUNDS_DROPLET: Bounds = { x: 0.56, top: -0.42, bottom: 0.85 };
const WALL_RESTITUTION = 0.38;

const FLOW_RESPONSE = 14; // 1/s — how quickly the fluid answers the hand (viscous lag)
const POINTER_VEL_DECAY = 9; // 1/s — a stopped hand stops pushing within ~100 ms
const PULSE_DECAY = 3.4; // 1/s — merge/impact ripple lifetime

const SETTLE_SPEED = 0.025;
const SETTLE_POS = 0.014;
/** Only hard-snap (and sleep) once this close — avoids a visible pop. */
const SETTLE_SNAP = 0.0025;
const SETTLE_PULSE = 0.02;
/** Soft ease toward rest once near-settled (1/s). */
const SETTLE_LERP = 14;
/** Pointer velocity EMA — irregular event timing no longer spikes the fluid. */
const POINTER_VEL_SMOOTH = 0.55;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Quadratic + linear viscous drag — fast motion bleeds energy far quicker than slow drift. */
function applyViscousDrag(p: BlobParticle, linear: number, quadratic: number, dt: number) {
  const speed = Math.hypot(p.vx, p.vy);
  if (speed < 1e-6) return;
  const factor = Math.max(0, 1 - (linear + quadratic * speed) * dt);
  p.vx *= factor;
  p.vy *= factor;
}

/** Soft wall collision — clamps position, reflects with restitution, reports impact speed. */
function clampToBounds(p: BlobParticle, bounds: Bounds, onImpact: (speed: number) => void) {
  if (p.x > bounds.x) {
    if (p.vx > 0) {
      onImpact(p.vx);
      p.vx = -p.vx * WALL_RESTITUTION;
    }
    p.x = bounds.x;
  } else if (p.x < -bounds.x) {
    if (p.vx < 0) {
      onImpact(-p.vx);
      p.vx = -p.vx * WALL_RESTITUTION;
    }
    p.x = -bounds.x;
  }
  if (p.y > bounds.bottom) {
    if (p.vy > 0) {
      onImpact(p.vy);
      p.vy = -p.vy * WALL_RESTITUTION;
    }
    p.y = bounds.bottom;
  } else if (p.y < bounds.top) {
    if (p.vy < 0) {
      onImpact(-p.vy);
      p.vy = -p.vy * WALL_RESTITUTION;
    }
    p.y = bounds.top;
  }
}

function isSettled(
  primary: BlobParticle,
  secondary: BlobParticle,
  droplet: BlobParticle,
  dropletMerged: boolean,
  pulse: number,
) {
  return (
    Math.hypot(primary.vx, primary.vy) < SETTLE_SPEED &&
    Math.hypot(secondary.vx, secondary.vy) < SETTLE_SPEED * 1.7 &&
    (dropletMerged || Math.hypot(droplet.vx, droplet.vy) < SETTLE_SPEED * 2) &&
    Math.abs(primary.x) < SETTLE_POS &&
    Math.abs(primary.y - REST_Y) < SETTLE_POS &&
    pulse < SETTLE_PULSE
  );
}


export function useLiquidBlobPhysics() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const animatingRef = useRef(false);
  const interactingRef = useRef(false);
  const capturingRef = useRef(false);
  const lastTimeRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);

  const pointerRef = useRef<MotionSample>({ x: 0.5, y: 0.5, vx: 0, vy: 0 });
  const pointerTimeRef = useRef(0);
  const containerRef = useRef<MotionSample>({ x: 0, y: 0, vx: 0, vy: 0 });

  const primaryRef = useRef<BlobParticle>({ x: 0, y: REST_Y, vx: 0, vy: 0 });
  const secondaryRef = useRef<BlobParticle>({ x: 0, y: REST_Y + 0.05, vx: 0, vy: 0 });
  const dropletRef = useRef<BlobParticle>({ x: 0, y: REST_Y + 0.1, vx: 0, vy: 0 });
  const dropletMergedRef = useRef(true);
  const pulseRef = useRef(0);
  const phaseRef = useRef(0);
  const flowRef = useRef({ vx: 0, vy: 0 });
  const stretchRef = useRef({ mag: 0, dirX: 1, dirY: 0 });
  const dropStretchRef = useRef({ mag: 0, dirX: 0, dirY: 1 });

  /**
   * Track the card's screen position. Container velocity only feeds the fluid
   * while the pointer is captured (drag) — hover CSS lifts (`translateY` /
   * `scale` on `.liquid-card`) would otherwise inject fake slosh every frame.
   */
  const sampleContainerMotion = useCallback((dtFrame = 1 / 60) => {
    const el = rootRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const prev = containerRef.current;
    const dt = Math.max(dtFrame, 1 / 240);
    if (capturingRef.current) {
      containerRef.current = {
        x: rect.left,
        y: rect.top,
        vx: clamp((rect.left - prev.x) / rect.width / dt, -10, 10),
        vy: clamp((rect.top - prev.y) / rect.height / dt, -10, 10),
      };
    } else {
      // Keep the anchor current so the next drag doesn't inherit a stale delta,
      // but kill residual velocity so hover/layout motion cannot jitter the pool.
      containerRef.current = { x: rect.left, y: rect.top, vx: 0, vy: 0 };
    }
  }, []);

  /** One fixed-timestep step of the fluid model (semi-implicit Euler). */
  const stepPhysics = useCallback((dt: number) => {
    const pointer = pointerRef.current;
    const flow = flowRef.current;
    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    const droplet = dropletRef.current;
    const active = interactingRef.current;

    phaseRef.current += dt;

    // The fluid answers hand motion with a viscous lag instead of instantly.
    const follow = 1 - Math.exp(-FLOW_RESPONSE * dt);
    flow.vx += (pointer.vx + containerRef.current.vx - flow.vx) * follow;
    flow.vy += (pointer.vy + containerRef.current.vy - flow.vy) * follow;

    // A living surface never sits perfectly still while touched — kept subtle
    // so it reads as surface tension, not jitter.
    const phase = phaseRef.current;
    const microX = active ? (Math.sin(phase * 2.3) + Math.sin(phase * 3.9 + 1.7)) * 0.12 : 0;
    const microY = active ? (Math.sin(phase * 2.9 + 0.6) + Math.sin(phase * 4.3 + 2.1)) * 0.09 : 0;

    // — Main body: underdamped spring home, pumped by the slosh forcing. —
    const spring = active ? SPRING_ACTIVE : SPRING_IDLE;
    const targetX = active ? (pointer.x - 0.5) * 0.22 : 0;
    const targetY = active ? REST_Y + (pointer.y - 0.55) * 0.12 : REST_Y;
    primary.vx += ((targetX - primary.x) * spring - flow.vx * SLOSH_PRIMARY + microX) * dt;
    primary.vy += ((targetY - primary.y) * spring - flow.vy * SLOSH_PRIMARY + microY) * dt;
    applyViscousDrag(primary, DRAG_LINEAR_PRIMARY, DRAG_QUAD_PRIMARY, dt);
    primary.x += primary.vx * dt;
    primary.y += primary.vy * dt;
    clampToBounds(primary, BOUNDS_PRIMARY, (impact) => {
      pulseRef.current = Math.min(pulseRef.current + impact * 0.22, 1.2);
    });

    // — Surface film: cohesion-tethered to the body, whippier and wetter. —
    const anchorX = primary.x * 1.28;
    const anchorY = primary.y + 0.05;
    secondary.vx +=
      ((anchorX - secondary.x) * SURFACE_SPRING -
        (secondary.vx - primary.vx * 0.6) * SURFACE_COUPLING -
        flow.vx * SLOSH_SURFACE +
        microX * 1.6) *
      dt;
    secondary.vy +=
      (SURFACE_GRAVITY +
        (anchorY - secondary.y) * SURFACE_SPRING -
        (secondary.vy - primary.vy * 0.6) * SURFACE_COUPLING -
        flow.vy * SLOSH_SURFACE +
        microY * 1.6) *
      dt;
    applyViscousDrag(secondary, DRAG_LINEAR_SURFACE, DRAG_QUAD_SURFACE, dt);
    secondary.x += secondary.vx * dt;
    secondary.y += secondary.vy * dt;
    clampToBounds(secondary, BOUNDS_SURFACE, (impact) => {
      pulseRef.current = Math.min(pulseRef.current + impact * 0.12, 1.2);
    });

    // — Droplet: ballistics + a surface-tension ligament that snaps it home. —
    const dropAnchorX = primary.x;
    const dropAnchorY = primary.y + 0.1;
    const offX = droplet.x - dropAnchorX;
    const offY = droplet.y - dropAnchorY;
    const dist = Math.max(Math.hypot(offX, offY), 1e-6);

    if (dropletMergedRef.current) {
      // Part of the pool — glued in place until the card is shaken hard enough.
      droplet.vx += ((dropAnchorX - droplet.x) * DROPLET_GLUE - droplet.vx * DROPLET_GLUE_DAMP) * dt;
      droplet.vy += ((dropAnchorY - droplet.y) * DROPLET_GLUE - droplet.vy * DROPLET_GLUE_DAMP) * dt;
      if (Math.hypot(flow.vx, flow.vy) > DETACH_FLOW) {
        dropletMergedRef.current = false;
        droplet.vx += flow.vx * 0.5;
        droplet.vy += flow.vy * 0.35 - 0.55; // pinch-off pop
      }
    } else {
      let ax = -flow.vx * SLOSH_DROPLET + primary.vx * 2;
      let ay = (dist > DROPLET_TETHER ? DROPLET_GRAVITY : DROPLET_GRAVITY_NEAR) - flow.vy * SLOSH_DROPLET * 0.6;
      if (dist > DROPLET_TETHER) {
        // Stretched ligament — pulls back harder the further it runs out.
        const excess = dist - DROPLET_TETHER;
        const nx = offX / dist;
        const ny = offY / dist;
        ax -= nx * excess * DROPLET_TETHER_SPRING;
        ay -= ny * excess * DROPLET_TETHER_SPRING;
        const radialV = droplet.vx * nx + droplet.vy * ny;
        if (radialV > 0) {
          ax -= nx * radialV * DROPLET_TETHER_DAMP;
          ay -= ny * radialV * DROPLET_TETHER_DAMP;
        }
      } else {
        // Inside the surface-tension zone — cohesion reels it back into the pool.
        ax += (dropAnchorX - droplet.x) * DROPLET_COHESION;
        ay += (dropAnchorY - droplet.y) * DROPLET_COHESION;
      }
      droplet.vx += ax * dt;
      droplet.vy += ay * dt;
    }
    applyViscousDrag(droplet, DRAG_LINEAR_DROPLET, DRAG_QUAD_DROPLET, dt);
    droplet.x += droplet.vx * dt;
    droplet.y += droplet.vy * dt;
    clampToBounds(droplet, BOUNDS_DROPLET, (impact) => {
      pulseRef.current = Math.min(pulseRef.current + impact * 0.1, 1.2);
    });

    // Recombine: a slow close approach is swallowed by the pool with a ripple.
    if (!dropletMergedRef.current) {
      const relSpeed = Math.hypot(droplet.vx - primary.vx, droplet.vy - primary.vy);
      if (dist < MERGE_RADIUS && relSpeed < MERGE_SPEED) {
        dropletMergedRef.current = true;
        pulseRef.current = Math.min(pulseRef.current + 0.35 + relSpeed * 0.45, 1.2);
        droplet.x = dropAnchorX;
        droplet.y = dropAnchorY;
        droplet.vx = primary.vx * 0.5;
        droplet.vy = primary.vy * 0.5;
      }
    }
  }, []);


  /** Push the simulation state into the CSS variables that render the liquid. */
  const applyVars = useCallback((dtFrame = 1 / 60) => {
    const el = rootRef.current;
    if (!el) return;

    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    const droplet = dropletRef.current;
    const flow = flowRef.current;
    const pulse = pulseRef.current;

    const speed = Math.hypot(primary.vx, primary.vy);
    const flowSpeed = Math.hypot(flow.vx, flow.vy);

    // Directional stretch — the body elongates along its velocity like a real
    // fluid parcel. Direction is vector-smoothed so it never snaps 180°.
    const stretch = stretchRef.current;
    const stretchTarget = Math.min(speed * 0.5, 0.34);
    stretch.mag += (stretchTarget - stretch.mag) * (1 - Math.exp(-14 * dtFrame));
    // Freeze stretch direction at low speed so the long axis never whips 180°.
    if (speed > 0.08) {
      const dirFollow = 1 - Math.exp(-18 * dtFrame);
      stretch.dirX += (primary.vx / speed - stretch.dirX) * dirFollow;
      stretch.dirY += (primary.vy / speed - stretch.dirY) * dirFollow;
      const len = Math.max(Math.hypot(stretch.dirX, stretch.dirY), 1e-6);
      stretch.dirX /= len;
      stretch.dirY /= len;
    }
    const stretchAngle = (Math.atan2(stretch.dirY, stretch.dirX) * 180) / Math.PI;

    const baseSx = 1 + Math.min(speed * 0.3, 0.3) - Math.min(Math.abs(primary.vy) * 0.07, 0.1);
    const baseSy = 1 + Math.min(Math.abs(primary.vy) * 0.2, 0.24) - Math.min(Math.abs(primary.vx) * 0.08, 0.12);
    const primarySx = baseSx * (1 + stretch.mag) * (1 + pulse * 0.22);
    const primarySy = (baseSy / (1 + stretch.mag * 0.8)) * (1 + pulse * 0.12);

    const tilt = clamp(primary.vx * 13 + flow.vx * 7, -26, 26);
    const surfaceTilt = clamp((secondary.vx - primary.vx) * 16 + secondary.vx * 3, -24, 24);

    // Droplet elongation — a flying drip stretches into a teardrop along its path.
    const dropSpeed = Math.hypot(droplet.vx, droplet.vy);
    const dropStretch = dropStretchRef.current;
    const dropTarget = Math.min(dropSpeed * 0.5, 0.55);
    const dropRate = dropTarget > dropStretch.mag ? 22 : 7; // fast stretch, slow relax
    dropStretch.mag += (dropTarget - dropStretch.mag) * (1 - Math.exp(-dropRate * dtFrame));
    if (dropSpeed > 0.06) {
      const dirFollow = 1 - Math.exp(-16 * dtFrame);
      dropStretch.dirX += (droplet.vx / dropSpeed - dropStretch.dirX) * dirFollow;
      dropStretch.dirY += (droplet.vy / dropSpeed - dropStretch.dirY) * dirFollow;
      const len = Math.max(Math.hypot(dropStretch.dirX, dropStretch.dirY), 1e-6);
      dropStretch.dirX /= len;
      dropStretch.dirY /= len;
    }
    const dropAngle = (Math.atan2(dropStretch.dirY, dropStretch.dirX) * 180) / Math.PI;
    const dropScale = 0.7 + Math.min(speed * 0.5 + flowSpeed * 0.45, 1) * 0.35;

    const r1 = 44 + clamp(primary.vy * 22 + primary.vx * 7, -15, 15);
    const r2 = 56 - clamp(primary.vy * 15 - primary.vx * 8, -14, 14);
    const r3 = 52 + clamp(primary.vx * 10 - primary.vy * 7, -14, 14);
    const r4 = 48 - clamp(primary.vx * 11 + primary.vy * 6, -14, 14);

    el.style.setProperty("--blob-x", `${(primary.x * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-y", `${(primary.y * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-x2", `${(secondary.x * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-y2", `${(secondary.y * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-drop-x", `${(droplet.x * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-drop-y", `${(droplet.y * 100).toFixed(2)}%`);
    el.style.setProperty("--blob-scale-x", baseSx.toFixed(3));
    el.style.setProperty("--blob-scale-y", baseSy.toFixed(3));
    el.style.setProperty("--blob-sx", primarySx.toFixed(3));
    el.style.setProperty("--blob-sy", primarySy.toFixed(3));
    el.style.setProperty("--blob-s2x", (baseSx * 0.88 * (1 + stretch.mag * 0.7)).toFixed(3));
    el.style.setProperty("--blob-s2y", ((baseSy * 1.06) / (1 + stretch.mag * 0.5)).toFixed(3));
    el.style.setProperty("--blob-stretch", stretch.mag.toFixed(3));
    el.style.setProperty("--blob-stretch-angle", `${stretchAngle.toFixed(1)}deg`);
    el.style.setProperty("--blob-tilt", `${tilt.toFixed(2)}deg`);
    el.style.setProperty("--blob-surface-tilt", `${surfaceTilt.toFixed(2)}deg`);
    el.style.setProperty("--blob-speed", Math.min(speed * 0.5 + flowSpeed * 0.45 + pulse * 0.4, 1).toFixed(3));
    el.style.setProperty("--blob-pulse", pulse.toFixed(3));
    el.style.setProperty("--blob-drop-sx", (dropScale * (1 + dropStretch.mag)).toFixed(3));
    el.style.setProperty("--blob-drop-sy", (dropScale / (1 + dropStretch.mag * 0.75)).toFixed(3));
    el.style.setProperty("--blob-drop-angle", `${dropAngle.toFixed(1)}deg`);
    el.style.setProperty("--blob-r1", `${clamp(r1, 30, 70).toFixed(1)}%`);
    el.style.setProperty("--blob-r2", `${clamp(r2, 30, 70).toFixed(1)}%`);
    el.style.setProperty("--blob-r3", `${clamp(r3, 30, 70).toFixed(1)}%`);
    el.style.setProperty("--blob-r4", `${clamp(r4, 30, 70).toFixed(1)}%`);
  }, []);


  const tick = useCallback(
    (now: number) => {
      const last = lastTimeRef.current;
      lastTimeRef.current = now;
      const dtFrame = last === null ? 1 / 60 : clamp((now - last) / 1000, 0, MAX_FRAME_DT);

      sampleContainerMotion(dtFrame);

      // A stopped hand stops pushing: raw pointer velocity is an impulse that
      // decays over ~100 ms; the smoothed "flow" is what actually drives slosh.
      const decay = Math.exp(-POINTER_VEL_DECAY * dtFrame);
      pointerRef.current.vx *= decay;
      pointerRef.current.vy *= decay;

      const primary = primaryRef.current;
      const secondary = secondaryRef.current;
      const droplet = dropletRef.current;
      const softSettling =
        !interactingRef.current &&
        isSettled(primary, secondary, droplet, dropletMergedRef.current, pulseRef.current);

      // While easing into sleep, skip integration so the soft lerp isn't fighting
      // the idle spring (that fight showed up as end-of-slosh jitter).
      if (!softSettling) {
        accumulatorRef.current = Math.min(
          accumulatorRef.current + dtFrame,
          PHYSICS_STEP * MAX_STEPS_PER_FRAME,
        );
        let steps = 0;
        while (accumulatorRef.current >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
          stepPhysics(PHYSICS_STEP);
          accumulatorRef.current -= PHYSICS_STEP;
          steps++;
        }
      } else {
        accumulatorRef.current = 0;
      }

      // Impact/merge ripples ring down exponentially.
      pulseRef.current *= Math.exp(-PULSE_DECAY * dtFrame);
      if (pulseRef.current < 0.001) pulseRef.current = 0;

      // Soft settle: ease into rest instead of popping when the sleep threshold
      // is crossed. Hard-snap only once positions are already pixel-close.
      if (softSettling) {
        const k = 1 - Math.exp(-SETTLE_LERP * dtFrame);
        primary.x += (0 - primary.x) * k;
        primary.y += (REST_Y - primary.y) * k;
        primary.vx *= 1 - k;
        primary.vy *= 1 - k;
        secondary.x += (0 - secondary.x) * k;
        secondary.y += (REST_Y + 0.05 - secondary.y) * k;
        secondary.vx *= 1 - k;
        secondary.vy *= 1 - k;
        droplet.x += (0 - droplet.x) * k;
        droplet.y += (REST_Y + 0.1 - droplet.y) * k;
        droplet.vx *= 1 - k;
        droplet.vy *= 1 - k;
        flowRef.current.vx *= 1 - k;
        flowRef.current.vy *= 1 - k;
        stretchRef.current.mag *= 1 - k;
        dropStretchRef.current.mag *= 1 - k;
        pulseRef.current *= 1 - k;
        dropletMergedRef.current = true;

        const atRest =
          Math.abs(primary.x) < SETTLE_SNAP &&
          Math.abs(primary.y - REST_Y) < SETTLE_SNAP &&
          Math.abs(secondary.x) < SETTLE_SNAP &&
          Math.abs(droplet.x) < SETTLE_SNAP &&
          pulseRef.current < SETTLE_PULSE * 0.5;

        if (atRest) {
          primary.x = 0;
          primary.y = REST_Y;
          primary.vx = 0;
          primary.vy = 0;
          secondary.x = 0;
          secondary.y = REST_Y + 0.05;
          secondary.vx = 0;
          secondary.vy = 0;
          droplet.x = 0;
          droplet.y = REST_Y + 0.1;
          droplet.vx = 0;
          droplet.vy = 0;
          flowRef.current.vx = 0;
          flowRef.current.vy = 0;
          stretchRef.current.mag = 0;
          dropStretchRef.current.mag = 0;
          pulseRef.current = 0;
          applyVars(dtFrame);
          animatingRef.current = false;
          rafRef.current = null;
          lastTimeRef.current = null;
          rootRef.current?.classList.remove("liquid-card--blob-active");
          return;
        }
      }

      applyVars(dtFrame);
      rafRef.current = requestAnimationFrame(tick);
    },
    [applyVars, sampleContainerMotion, stepPhysics],
  );

  const startLoop = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    sampleContainerMotion();
    if (animatingRef.current) return;
    animatingRef.current = true;
    lastTimeRef.current = null;
    accumulatorRef.current = 0;
    rootRef.current?.classList.add("liquid-card--blob-active");
    rafRef.current = requestAnimationFrame(tick);
  }, [sampleContainerMotion, tick]);

  /** Returns the normalized pointer position, or null when the rect is unusable. */
  const updatePointer = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current;
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);

    const now = performance.now();
    const dtEvent = clamp((now - pointerTimeRef.current) / 1000, 1 / 240, 0.25);
    pointerTimeRef.current = now;

    const prev = pointerRef.current;
    const rawVx = clamp((nx - prev.x) / dtEvent, -8, 8);
    const rawVy = clamp((ny - prev.y) / dtEvent, -8, 8);
    pointerRef.current = {
      x: nx,
      y: ny,
      vx: prev.vx * (1 - POINTER_VEL_SMOOTH) + rawVx * POINTER_VEL_SMOOTH,
      vy: prev.vy * (1 - POINTER_VEL_SMOOTH) + rawVy * POINTER_VEL_SMOOTH,
    };
    return { x: nx, y: ny };
  }, []);

  /** Pressing the surface dents it — particles are shoved away from the press point. */
  const pokeSurface = useCallback((nx: number, ny: number) => {
    const ox = nx - 0.5;
    const oy = ny - 0.5;
    const bodies: Array<[BlobParticle, number]> = [
      [primaryRef.current, 0.9],
      [secondaryRef.current, 1.2],
    ];
    if (!dropletMergedRef.current) bodies.push([dropletRef.current, 1.5]);
    for (const [body, gain] of bodies) {
      const dx = body.x - ox;
      const dy = body.y - oy;
      const dist = Math.max(Math.hypot(dx, dy), 0.08);
      const force = gain * Math.min(0.1 / (dist * dist), 2.4);
      body.vx += (dx / dist) * force;
      body.vy += (dy / dist) * force;
    }
    pulseRef.current = Math.min(pulseRef.current + 0.32, 1.2);
  }, []);

  const releaseInteraction = useCallback(() => {
    interactingRef.current = false;
    pointerRef.current = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    // Drop any drag-injected container velocity so release doesn't kick the pool.
    containerRef.current.vx = 0;
    containerRef.current.vy = 0;
    // Surface rebound blip as the "finger" lifts off the liquid.
    pulseRef.current = Math.min(pulseRef.current + 0.12, 1.2);
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
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // jsdom and older WebViews may not support pointer capture.
      }
      const point = updatePointer(event.clientX, event.clientY);
      if (point) pokeSurface(point.x, point.y);
      startLoop();
    },
    [pokeSurface, startLoop, updatePointer],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      capturingRef.current = false;
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      } catch {
        // jsdom and older WebViews may not support pointer capture.
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

