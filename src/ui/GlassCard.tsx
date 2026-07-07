import React from "react";
import { mergeDivRefs, useLiquidBlobPhysics } from "../hooks/useLiquidBlobPhysics";
import { LiquidCardBlob } from "./LiquidCardBlob";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

/**
 * Interactive glass card — the app's `.liquid-card`. Lifts and gains a red
 * edge glow on hover. Used for Kanban task cards and other primary list items.
 */
export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className = "", onPointerEnter, onPointerMove, onPointerLeave, onPointerDown, onPointerUp, ...props }, ref) => {
    const blob = useLiquidBlobPhysics();

    return (
      <div
        ref={mergeDivRefs(ref, blob.setRootRef)}
        className={`liquid-card rounded-[2rem] border border-white/5 ${className}`}
        onPointerEnter={(event) => {
          blob.onPointerEnter(event);
          onPointerEnter?.(event);
        }}
        onPointerMove={(event) => {
          blob.onPointerMove(event);
          onPointerMove?.(event);
        }}
        onPointerLeave={(event) => {
          blob.onPointerLeave();
          onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          blob.onPointerDown(event);
          onPointerDown?.(event);
        }}
        onPointerUp={(event) => {
          blob.onPointerUp(event);
          onPointerUp?.(event);
        }}
        {...props}
      >
        <LiquidCardBlob />
        <div className="relative z-[1]">{children}</div>
      </div>
    );
  },
);
GlassCard.displayName = "GlassCard";

export default GlassCard;
