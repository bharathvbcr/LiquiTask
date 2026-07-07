import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  children: React.ReactNode;
  placement?: PopoverPlacement;
  className?: string;
  contentClassName?: string;
  /** Minimum gap from viewport edges in px */
  offset?: number;
}

interface Coords {
  top: number;
  left: number;
}

function computePosition(
  triggerRect: DOMRect,
  contentRect: DOMRect,
  placement: PopoverPlacement,
  offset: number,
): Coords {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = offset;

  let top = 0;
  let left = 0;

  const placeBottom = () => {
    top = triggerRect.bottom + gap;
    left = placement.endsWith("end") ? triggerRect.right - contentRect.width : triggerRect.left;
  };

  const placeTop = () => {
    top = triggerRect.top - contentRect.height - gap;
    left = placement.endsWith("end") ? triggerRect.right - contentRect.width : triggerRect.left;
  };

  const preferBottom = placement.startsWith("bottom");
  if (preferBottom) {
    placeBottom();
    if (top + contentRect.height > vh - gap) {
      placeTop();
    }
  } else {
    placeTop();
    if (top < gap) {
      placeBottom();
    }
  }

  // Horizontal clamp
  if (left + contentRect.width > vw - gap) {
    left = vw - contentRect.width - gap;
  }
  if (left < gap) {
    left = gap;
  }

  // Vertical clamp
  if (top + contentRect.height > vh - gap) {
    top = vh - contentRect.height - gap;
  }
  if (top < gap) {
    top = gap;
  }

  return { top, left };
}

export const Popover: React.FC<PopoverProps> = ({
  open,
  onOpenChange,
  trigger,
  children,
  placement = "bottom-start",
  className = "",
  contentClassName = "",
  offset = 8,
}) => {
  const triggerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<Coords>({ top: 0, left: 0 });
  const [positioned, setPositioned] = useState(false);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !contentRef.current) return;
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const contentRect = contentRef.current.getBoundingClientRect();
    setCoords(computePosition(triggerRect, contentRect, placement, offset));
  }, [placement, offset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `children` is intentionally listed so the popover repositions when its content changes size
  useLayoutEffect(() => {
    if (!open) {
      setPositioned(false);
      return;
    }
    updatePosition();
    setPositioned(true);
  }, [open, updatePosition, children]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        contentRef.current?.contains(target)
      ) {
        return;
      }
      onOpenChange(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };

    const handleReposition = () => updatePosition();

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open, onOpenChange, updatePosition]);

  const stopDragPropagation = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  const triggerElement = (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      className={`inline-flex ${className}`}
      onPointerDown={stopDragPropagation}
      style={{ display: "inline-flex" }}
    >
      {trigger}
    </span>
  );

  return (
    <>
      {triggerElement}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contentRef}
            role="presentation"
            className={`fixed z-[9998] transition-opacity duration-75 ${positioned ? "opacity-100" : "opacity-0"} ${contentClassName}`}
            style={{ top: coords.top, left: coords.left }}
            onPointerDown={stopDragPropagation}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
};
