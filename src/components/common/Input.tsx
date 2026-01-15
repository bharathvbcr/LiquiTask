import React, { forwardRef } from 'react';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    rightElement?: React.ReactNode;
    size?: 'sm' | 'md';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
    label,
    error,
    icon,
    rightElement,
    className = '',
    size = 'md',
    id,
    ...props
}, ref) => {
    const inputId = id || props.name;

    const sizeStyles = {
        sm: 'px-3 py-1.5 text-xs rounded-lg',
        md: 'px-4 py-3 text-sm rounded-xl',
    };

    return (
        <div className={`space-y-1.5 ${className}`}>
            {label && (
                <label
                    htmlFor={inputId}
                    className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2"
                >
                    {icon && <span className="text-slate-500">{icon}</span>}
                    {label}
                </label>
            )}
            <div className="relative">
                <input
                    ref={ref}
                    id={inputId}
                    className={`
            w-full bg-black/20 border text-slate-200 placeholder-slate-500 outline-none
            transition-all duration-200
            ${sizeStyles[size]}
            ${error
                            ? 'border-red-500/50 focus:border-red-500 focus:shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                            : 'border-white/10 focus:border-red-500/50 focus:shadow-sm hover:border-white/20'
                        }
            ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
                    {...props}
                />
                {rightElement && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
                        {rightElement}
                    </div>
                )}
            </div>
            {error && (
                <p className="text-xs text-red-400 pl-1 animate-in slide-in-from-top-1 fade-in">
                    {error}
                </p>
            )}
        </div>
    );
});

Input.displayName = 'Input';
