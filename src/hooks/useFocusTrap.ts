import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "[contenteditable]",
].join(", ");

export function useFocusTrap(isActive: boolean, onClose?: () => void) {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    triggerRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
        return;
      }

      if (e.key !== "Tab") return;

      const modal = document.querySelector("[data-modal]") as HTMLElement;
      if (!modal) return;

      const focusableElements = Array.from(
        modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    setTimeout(() => {
      const modal = document.querySelector("[data-modal]") as HTMLElement;
      if (modal) {
        const focusableElements = Array.from(
          modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
        );
        focusableElements[0]?.focus();
      }
    }, 50);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [isActive, onClose]);
}
