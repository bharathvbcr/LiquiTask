import type React from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FEATURE_FLAGS } from "../constants";

type TooltipChildProps = React.HTMLAttributes<HTMLElement> & {
  ref?: React.Ref<HTMLElement>;
  disabled?: boolean;
};

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<TooltipChildProps>;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref && typeof ref === "object") {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    }
  };
}

export const Tooltip: React.FC<TooltipProps> = (props) => {
  if (!FEATURE_FLAGS.TOOLTIPS_ENABLED) {
    return props.children;
  }

  return <TooltipActive {...props} />;
};

const TooltipActive: React.FC<TooltipProps> = ({
  content,
  children,
  delay = 300,
  position = "top",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsPositioned(false);
      setIsVisible(true);
      // Position will be updated in useEffect after render
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
    setIsPositioned(false);
  };

  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  const updatePosition = useCallback(
    (retryCount = 0) => {
      if (!triggerRef.current || !tooltipRef.current) return;

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      // Fallback to offsetWidth/offsetHeight if getBoundingClientRect returns zero dimensions
      const tooltipWidth = tooltipRect.width || tooltipRef.current.offsetWidth || 0;
      const tooltipHeight = tooltipRect.height || tooltipRef.current.offsetHeight || 0;

      // If tooltip doesn't have dimensions yet, retry after a short delay
      if ((tooltipWidth === 0 || tooltipHeight === 0) && retryCount < 5) {
        requestAnimationFrame(() => {
          updatePosition(retryCount + 1);
        });
        return;
      }

      // Viewport-relative coordinates: the tooltip renders position:fixed in a
      // body portal, so scroll offsets must NOT be added.
      let top = 0;
      let left = 0;

      switch (position) {
        case "top":
          top = triggerRect.top - tooltipHeight - 8;
          left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
          break;
        case "bottom":
          top = triggerRect.bottom + 8;
          left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2;
          break;
        case "left":
          top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
          left = triggerRect.left - tooltipWidth - 8;
          break;
        case "right":
          top = triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2;
          left = triggerRect.right + 8;
          break;
      }

      // Keep tooltip within viewport
      const padding = 8;
      if (left < padding) left = padding;
      if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding;
      }
      if (top < padding) top = padding;
      if (top + tooltipHeight > window.innerHeight - padding) {
        top = window.innerHeight - tooltipHeight - padding;
      }

      setTooltipPosition({ top, left });
      setIsPositioned(true);
    },
    [position],
  );

  useEffect(() => {
    if (isVisible && tooltipRef.current) {
      // Use double requestAnimationFrame to ensure DOM is fully updated and rendered
      // First RAF: React has updated the DOM
      // Second RAF: Browser has painted the changes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updatePosition();
        });
      });
      const handleResize = () => updatePosition();
      const handleScroll = () => updatePosition();
      window.addEventListener("resize", handleResize);
      window.addEventListener("scroll", handleScroll, true);
      return () => {
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [isVisible, updatePosition]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getArrowPosition = () => {
    switch (position) {
      case "top":
        return "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45";
      case "bottom":
        return "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45";
      case "left":
        return "right-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45";
      case "right":
        return "left-0 top-1/2 translate-x-1/2 -translate-y-1/2 rotate-45";
    }
  };

  const child = Children.only(children);
  if (!isValidElement(child)) {
    return children;
  }

  const describedBy = isVisible
    ? [child.props["aria-describedby"], tooltipId].filter(Boolean).join(" ")
    : child.props["aria-describedby"];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    child.props.onKeyDown?.(event);
    if (event.key === "Escape" && isVisible) {
      hideTooltip();
    }
  };

  // Disabled elements never receive focus (and some browsers suppress their
  // pointer events too), so a disabled trigger can never show its tooltip to
  // keyboard or screen-reader users. Route the listeners through a focusable
  // wrapper instead — must be a real box (not display:contents), or
  // getBoundingClientRect() returns all zeros and positioning breaks.
  const trigger = child.props.disabled ? (
    <span
      ref={mergeRefs(triggerRef)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: intentionally focusable — it's a tooltip proxy for a disabled control, not a real interactive element
      tabIndex={0}
      className="inline-block"
      aria-describedby={describedBy}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={handleKeyDown}
    >
      {child}
    </span>
  ) : (
    cloneElement(child, {
      ref: mergeRefs(triggerRef, child.props.ref),
      "aria-describedby": describedBy,
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onMouseEnter?.(event);
        showTooltip();
      },
      onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onMouseLeave?.(event);
        hideTooltip();
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        child.props.onFocus?.(event);
        showTooltip();
      },
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        child.props.onBlur?.(event);
        hideTooltip();
      },
      onKeyDown: handleKeyDown,
    })
  );

  return (
    <>
      {trigger}
      {isVisible &&
        typeof document !== "undefined" &&
        createPortal(
          /* eslint-disable-next-line react/forbid-dom-props */
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className={`fixed z-[9999] pointer-events-none ${
              isPositioned ? "animate-in fade-in duration-150" : "opacity-0"
            }`}
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
            }}
          >
            <div className="px-3.5 py-2.5 liquid-surface rounded-xl shadow-2xl max-w-xs">
              <div
                className={`absolute w-2 h-2 bg-[#0c0606] border-l border-b border-white/10 ${getArrowPosition()}`}
              />
              <div className="relative z-10 text-sm">{content}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
