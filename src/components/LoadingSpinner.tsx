import type React from "react";

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  text?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 24,
  className = "",
  text,
}) => {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative">
        <div
          className="animate-spin rounded-full border-2 border-transparent"
          style={{
            width: size,
            height: size,
            borderTopColor: "rgba(239, 68, 68, 0.9)",
            borderRightColor: "rgba(239, 68, 68, 0.3)",
            filter: "drop-shadow(0 0 8px rgba(239, 68, 68, 0.5))",
          }}
        />
        <div
          className="absolute inset-0 rounded-full opacity-30 blur-md"
          style={{ background: "radial-gradient(circle, rgba(239,68,68,0.6) 0%, transparent 70%)" }}
        />
      </div>
      {text && <p className="text-sm font-medium text-slate-400 animate-pulse">{text}</p>}
    </div>
  );
};
