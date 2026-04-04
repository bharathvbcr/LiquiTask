import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({ 
  content, 
  children, 
  position = "top",
  delay = 200 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const childrenRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  if (!content) return children;

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  const handleClick = () => {
    setIsVisible(false);
  };

  const updatePosition = () => {
    if (childrenRef.current) {
      const rect = childrenRef.current.getBoundingClientRect();
      let top = 0;
      let left = 0;

      // Adjust based on position
      switch (position) {
        case "top":
          top = rect.top - 8;
          left = rect.left + rect.width / 2;
          break;
        case "bottom":
          top = rect.bottom + 8;
          left = rect.left + rect.width / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2;
          left = rect.left - 8;
          break;
        case "right":
          top = rect.top + rect.height / 2;
          left = rect.right + 8;
          break;
      }
      setCoords({ top, left });
    }
  };

  useEffect(() => {
    if (isVisible) {
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
    }
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isVisible]);

  const clonedChildren = React.cloneElement(children as React.ReactElement<any>, {
    ref: childrenRef,
    onMouseEnter: (e: React.MouseEvent) => {
      handleMouseEnter();
      if ((children as React.ReactElement<any>).props.onMouseEnter) (children as React.ReactElement<any>).props.onMouseEnter(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleMouseLeave();
      if ((children as React.ReactElement<any>).props.onMouseLeave) (children as React.ReactElement<any>).props.onMouseLeave(e);
    },
    onClick: (e: React.MouseEvent) => {
      handleClick();
      if ((children as React.ReactElement<any>).props.onClick) (children as React.ReactElement<any>).props.onClick(e);
    }
  });

  const getTransform = () => {
    switch (position) {
      case "top": return "translate(-50%, -100%) scale(var(--scale, 1))";
      case "bottom": return "translate(-50%, 0) scale(var(--scale, 1))";
      case "left": return "translate(-100%, -50%) scale(var(--scale, 1))";
      case "right": return "translate(0, -50%) scale(var(--scale, 1))";
    }
  };

  const getArrowClasses = () => {
    switch (position) {
      case "top": return "top-full left-1/2 -translate-x-1/2 border-t-zinc-900 border-l-transparent border-r-transparent border-b-transparent";
      case "bottom": return "bottom-full left-1/2 -translate-x-1/2 border-b-zinc-900 border-l-transparent border-r-transparent border-t-transparent";
      case "left": return "left-full top-1/2 -translate-y-1/2 border-l-zinc-900 border-t-transparent border-b-transparent border-r-transparent";
      case "right": return "right-full top-1/2 -translate-y-1/2 border-r-zinc-900 border-t-transparent border-b-transparent border-l-transparent";
    }
  };

  return (
    <>
      {clonedChildren}
      {isVisible && typeof document !== "undefined" && createPortal(
        <div 
          className="fixed z-[9999] pointer-events-none animate-in fade-in zoom-in-95 duration-150 ease-out"
          style={{ 
            top: coords.top, 
            left: coords.left, 
            transform: getTransform() 
          }}
        >
          <div className="relative px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap bg-zinc-900/90 backdrop-blur-md rounded-lg shadow-[0_8px_30px_rgb(0,0,0,0.4)] border border-white/10 flex items-center justify-center">
            {content}
            <div className={`absolute w-0 h-0 border-[5px] ${getArrowClasses()}`} />
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
