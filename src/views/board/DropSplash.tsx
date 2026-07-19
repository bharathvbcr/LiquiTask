import type React from "react";
import { createPortal } from "react-dom";

import type { DropSplash as DropSplashData } from "../../hooks/useBoardDnDController";

interface DropSplashProps {
  splash: DropSplashData | null;
}

// Eight droplets flung around the drop point, alternating heavy/large and
// light/small. Each gets its own ballistic arc height and flight time so the
// spray reads as mass under gravity rather than a uniform starburst.
const DROPLETS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const large = i % 2 === 0;
  const radius = large ? 56 : 38;
  const size = large ? 10 : 6.5;
  return {
    key: i,
    dx: `${(Math.cos(angle) * radius).toFixed(1)}px`,
    dy: `${(Math.sin(angle) * radius * 0.72).toFixed(1)}px`,
    arc: `${(large ? 30 : 18) + (i % 3) * 4}px`,
    size: `${size}px`,
    offset: `${(-size / 2).toFixed(2)}px`,
    delay: `${((i % 4) * 0.025).toFixed(3)}s`,
    dur: `${(0.62 + (i % 3) * 0.07).toFixed(2)}s`,
  };
});

/**
 * The liquid "splash" that radiates from where a task card is dropped —
 * two morphing shockwave rings, an opening crown, a Worthington rebound jet,
 * and a spray of ballistic droplets that arc under gravity and splat flat.
 * Rendered in a body portal so it floats above the board, keyed so each drop
 * restarts the animation.
 */
export const DropSplash: React.FC<DropSplashProps> = ({ splash }) => {
  if (!splash || typeof document === "undefined") return null;

  return createPortal(
    <span
      key={splash.id}
      className="lt-splash"
      aria-hidden="true"
      style={{ left: splash.x, top: splash.y }}
    >
      <span className="ring" />
      <span className="ring ring2" />
      <span className="crown" />
      <span className="jet" />
      <span className="jet-drop" />
      {DROPLETS.map((d) => (
        <span
          key={d.key}
          className="drop"
          style={
            {
              "--dx": d.dx,
              "--dy": d.dy,
              "--arc": d.arc,
              "--dur": d.dur,
              width: d.size,
              height: d.size,
              margin: `${d.offset} 0 0 ${d.offset}`,
              animationDelay: d.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </span>,
    document.body,
  );
};

export default DropSplash;
