import type React from "react";
import { createPortal } from "react-dom";

import type { DropSplash as DropSplashData } from "../../hooks/useBoardDnDController";

interface DropSplashProps {
  splash: DropSplashData | null;
}

// Six droplets flung outward evenly around the drop point.
const DROPLETS = Array.from({ length: 6 }, (_, i) => {
  const angle = (i / 6) * Math.PI * 2;
  return {
    key: i,
    dx: `${Math.cos(angle) * 52}px`,
    dy: `${Math.sin(angle) * 40}px`,
    delay: `${(i % 3) * 0.03}s`,
  };
});

/**
 * The liquid "splash" that radiates from where a task card is dropped —
 * two expanding red rings plus a spray of droplets. Rendered in a body portal
 * so it floats above the board, keyed so each drop restarts the animation.
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
      {DROPLETS.map((d) => (
        <span
          key={d.key}
          className="drop"
          style={
            {
              "--dx": d.dx,
              "--dy": d.dy,
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
