import React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Tints the button red, as if it were a toggled-on tool (e.g. an open panel). */
  active?: boolean;
}

/** Square glass icon button used throughout LiquiTask's toolbars and headers. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ active = false, className = "", type = "button", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={`icon-btn relative inline-flex items-center justify-center border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 ${
          active
            ? "border-red-500/20 bg-red-500/10 text-red-400"
            : "border-transparent text-slate-400 hover:text-white"
        } ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";

export default IconButton;
