import { Loader2 } from "lucide-react";
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
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`}>
      <Loader2 size={size} className="animate-spin text-red-400" />
      {text && <p className="text-sm text-slate-400">{text}</p>}
    </div>
  );
};
