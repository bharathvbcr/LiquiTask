import type React from "react";

/**
 * Ambient animated backdrop — slow-drifting crimson "liquid glass" blobs over
 * the warm near-black canvas from the LiquiTask design system.
 *
 * Replaces the previous static `via-slate-950` gradient (a blue-tinted layer
 * that hid the warm `#030000` body background). Motion is GPU-friendly
 * (transform/opacity only) and fully suppressed under `prefers-reduced-motion`
 * via the keyframes in index.css.
 */
export const LiquidBackdrop: React.FC = () => (
  <div aria-hidden className="liquid-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden">
    <div className="liquid-backdrop__base" />
    <div className="liquid-backdrop__blob liquid-backdrop__blob--1" />
    <div className="liquid-backdrop__blob liquid-backdrop__blob--2" />
    <div className="liquid-backdrop__blob liquid-backdrop__blob--3" />
    <div className="liquid-backdrop__blob liquid-backdrop__blob--4" />
    <div className="liquid-backdrop__sheen" />
  </div>
);

export default LiquidBackdrop;
