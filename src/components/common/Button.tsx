import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonColor = 'red' | 'blue';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    color?: ButtonColor;
    isLoading?: boolean;
    icon?: React.ReactNode;
    fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    color = 'red',
    isLoading = false,
    icon,
    fullWidth = false,
    className = '',
    disabled,
    ...props
}) => {
    const baseStyles = 'inline-flex items-center justify-center font-bold transition-all duration-300 transform active:scale-95 disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl';

    const sizeStyles = {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-6 py-2.5 text-sm',
        lg: 'px-8 py-3.5 text-base',
    };

    const getVariantStyles = () => {
        switch (variant) {
            case 'primary':
                return color === 'blue'
                    ? 'relative text-white overflow-hidden group border-none shadow-[0_0_15px_rgba(59,130,246,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)]'
                    : 'relative text-white overflow-hidden group border-none shadow-[0_0_15px_rgba(220,38,38,0.4)] hover:shadow-[0_0_30px_rgba(255,30,30,0.6)]';
            case 'secondary':
                return 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/5 hover:border-white/10';
            case 'ghost':
                return 'bg-transparent hover:bg-white/5 text-slate-400 hover:text-white';
            case 'danger':
                return 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 hover:border-red-500/40';
            default:
                return '';
        }
    };

    const content = (
        <div className={`flex items-center gap-2 ${variant === 'primary' ? 'relative z-10' : ''}`}>
            {isLoading && <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 18} />}
            {!isLoading && icon && <span className="flex-shrink-0">{icon}</span>}
            <span>{children}</span>
        </div>
    );

    return (
        <button
            className={`${baseStyles} ${sizeStyles[size]} ${getVariantStyles()} ${fullWidth ? 'w-full' : ''} ${className}`}
            disabled={disabled || isLoading}
            {...props}
        >
            {variant === 'primary' && !disabled && (
                <>
                    {/* Base Liquid Layer */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${color === 'blue' ? 'from-blue-600 to-blue-800' : 'from-red-700 to-red-900'} z-0`}></div>

                    {/* Viscous Ripple Overlay */}
                    <div className="absolute inset-0 z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                        <div className={`absolute inset-0 ${color === 'blue' ? 'bg-blue-500/30' : 'bg-red-600/30'} mix-blend-overlay animate-ripple`}></div>
                    </div>

                    {/* Shine Effect */}
                    <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/20 to-transparent z-0 pointer-events-none opacity-50"></div>

                    {/* Bottom Highlight */}
                    <div className="absolute bottom-0 left-0 w-full h-1/3 bg-gradient-to-t from-black/20 to-transparent z-0 pointer-events-none"></div>
                </>
            )}
            {content}
        </button>
    );
};
