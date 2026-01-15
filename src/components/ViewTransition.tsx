import React, { useState, useEffect, useRef } from 'react';

export type TransitionType = 'fade' | 'slide-right' | 'slide-left' | 'slide-up' | 'slide-down' | 'scale';

interface ViewTransitionProps {
  children: React.ReactNode;
  transitionKey: string | number;
  type?: TransitionType;
  duration?: number;
  className?: string;
}

export const ViewTransition: React.FC<ViewTransitionProps> = ({
  children,
  transitionKey,
  type = 'fade',
  duration = 400,
  className = '',
}) => {
  const [displayChildren, setDisplayChildren] = useState(children);
  const [isAnimating, setIsAnimating] = useState(false);
  const previousKeyRef = useRef<string | number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // On initial mount, just set children without exit animation
    if (isInitialMount.current) {
      isInitialMount.current = false;
      previousKeyRef.current = transitionKey;
      setDisplayChildren(children);
      return;
    }

    // Only animate if the key actually changed
    if (previousKeyRef.current !== transitionKey) {
      setIsAnimating(true);
      
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Start exit animation, then update content and start enter animation
      const exitDuration = duration * 0.3; // Exit is faster

      timeoutRef.current = setTimeout(() => {
        setDisplayChildren(children);
        previousKeyRef.current = transitionKey;
        
        // Small delay before starting enter animation
        setTimeout(() => {
          setIsAnimating(false);
        }, 10);
      }, exitDuration);
    } else {
      // Key hasn't changed, just update children without animation
      setDisplayChildren(children);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [children, transitionKey, duration]);

  const getAnimationClasses = () => {
    if (isAnimating) {
      // Exit animation
      switch (type) {
        case 'fade':
          return 'animate-fade-out';
        case 'slide-right':
          return 'animate-slide-out-left';
        case 'slide-left':
          return 'animate-slide-out-right';
        case 'slide-up':
          return 'animate-slide-in-down';
        case 'slide-down':
          return 'animate-slide-in-up';
        case 'scale':
          return 'animate-scale-out';
        default:
          return 'animate-fade-out';
      }
    } else {
      // Enter animation (or initial render)
      switch (type) {
        case 'fade':
          return 'animate-fade-in';
        case 'slide-right':
          return 'animate-slide-in-right';
        case 'slide-left':
          return 'animate-slide-in-left';
        case 'slide-up':
          return 'animate-slide-in-up';
        case 'slide-down':
          return 'animate-slide-in-down';
        case 'scale':
          return 'animate-scale-in';
        default:
          return 'animate-fade-in';
      }
    }
  };

  return (
    <div
      className={`view-transition ${getAnimationClasses()} ${className}`}
      style={{
        animationDuration: `${duration}ms`,
      }}
    >
      {displayChildren}
    </div>
  );
};
