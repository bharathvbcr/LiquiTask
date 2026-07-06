import type React from "react";

export interface StreamTextProps {
  text: string;
  isStreaming?: boolean;
  className?: string;
}

/** Renders streamed text with a subtle shimmer + blinking cursor while isStreaming is true. */
export const StreamText: React.FC<StreamTextProps> = ({ text, isStreaming = false, className = "" }) => {
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {isStreaming ? (
        <span className="skeleton-shimmer bg-clip-text text-transparent">{text}</span>
      ) : (
        text
      )}
      {isStreaming && (
        <span
          className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-current align-middle"
          aria-hidden
        />
      )}
    </span>
  );
};

export default StreamText;
