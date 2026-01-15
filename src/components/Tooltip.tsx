import React, { useState, useRef, useEffect, useCallback } from 'react';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  delay?: number;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  delay = 300,
  position = 'top',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const showTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
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
  };

  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  const updatePosition = useCallback((retryCount = 0) => {
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

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = triggerRect.top + scrollY - tooltipHeight - 8;
        left = triggerRect.left + scrollX + triggerRect.width / 2 - tooltipWidth / 2;
        break;
      case 'bottom':
        top = triggerRect.bottom + scrollY + 8;
        left = triggerRect.left + scrollX + triggerRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = triggerRect.top + scrollY + triggerRect.height / 2 - tooltipHeight / 2;
        left = triggerRect.left + scrollX - tooltipWidth - 8;
        break;
      case 'right':
        top = triggerRect.top + scrollY + triggerRect.height / 2 - tooltipHeight / 2;
        left = triggerRect.right + scrollX + 8;
        break;
    }

    // Keep tooltip within viewport
    const padding = 8;
    if (left < padding) left = padding;
    if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - tooltipWidth - padding;
    }
    if (top < padding) top = padding;
    if (top + tooltipHeight > window.innerHeight + scrollY - padding) {
      top = window.innerHeight + scrollY - tooltipHeight - padding;
    }

    setTooltipPosition({ top, left });
  }, [position]);

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
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleScroll, true);
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

  const triggerElement = React.cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Preserve any existing ref
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingRef = (children as any).ref;
      if (typeof existingRef === 'function') {
        existingRef(node);
      } else if (existingRef) {
        (existingRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      showTooltip();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hideTooltip();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      showTooltip();
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      hideTooltip();
      children.props.onBlur?.(e);
    },
  });

  const getArrowPosition = () => {
    switch (position) {
      case 'top':
        return 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rotate-45';
      case 'bottom':
        return 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45';
      case 'left':
        return 'right-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45';
      case 'right':
        return 'left-0 top-1/2 translate-x-1/2 -translate-y-1/2 rotate-45';
    }
  };

  return (
    <>
      {triggerElement}
      {isVisible && (
        /* eslint-disable-next-line react/forbid-dom-props */
        <div
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none animate-in fade-in duration-150"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
          }}
        >
          <div className="px-3 py-2 bg-[#1a1a2e] border border-white/10 rounded-lg shadow-2xl max-w-xs">
            <div
              className={`absolute w-2 h-2 bg-[#1a1a2e] border-l border-b border-white/10 ${getArrowPosition()}`}
            />
            <div className="relative z-10">{content}</div>
          </div>
        </div>
      )}
    </>
  );
};
