/**
 * Small copy-to-clipboard button with a transient "Copied" confirmation.
 * Reused for run logs and error details across the dock, inbox, and run detail.
 */
import { Check, Copy } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  /** Text to copy, or a getter invoked at click time (lazy formatting). */
  text: string | (() => string);
  /** Optional visible label (icon-only when omitted). */
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
  iconSize?: number;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
  text,
  label,
  copiedLabel = "Copied",
  title,
  className,
  iconSize = 11,
}) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const value = typeof text === "function" ? text() : text;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard can be unavailable (permissions / insecure context); no-op.
      }
    },
    [text],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title ?? label ?? "Copy"}
      aria-label={title ?? label ?? "Copy"}
      className={
        className ??
        "inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-200 transition-colors"
      }
    >
      {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      {label ? <span>{copied ? copiedLabel : label}</span> : null}
    </button>
  );
};

export default CopyButton;
