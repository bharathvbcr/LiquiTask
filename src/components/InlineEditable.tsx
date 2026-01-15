import React, { useState, useEffect, useRef } from 'react';

interface InlineEditableProps {
    value: string;
    onSave: (newValue: string) => void;
    onCancel?: () => void;
    placeholder?: string;
    className?: string;
    multiline?: boolean;
    autoFocus?: boolean;
}

export const InlineEditable: React.FC<InlineEditableProps> = ({
    value,
    onSave,
    onCancel,
    placeholder = 'Enter value...',
    className = '',
    multiline = false,
    autoFocus = true,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        setEditValue(value);
    }, [value]);

    useEffect(() => {
        if (isEditing && autoFocus && inputRef.current) {
            inputRef.current.focus();
            if (inputRef.current instanceof HTMLInputElement) {
                inputRef.current.select();
            }
        }
    }, [isEditing, autoFocus]);

    const handleStartEdit = () => {
        setIsEditing(true);
        setEditValue(value);
    };

    const handleSave = () => {
        if (editValue.trim() !== value) {
            onSave(editValue.trim());
        }
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditValue(value);
        setIsEditing(false);
        onCancel?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Enter' && multiline && e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    };

    const handleBlur = () => {
        // Delay to allow click events to fire first
        setTimeout(() => {
            handleSave();
        }, 200);
    };

    if (isEditing) {
        const InputComponent = multiline ? 'textarea' : 'input';
        return (
            <InputComponent
                ref={inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder={placeholder}
                className={`bg-black/40 border border-red-500/50 rounded px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-red-500/50 ${className}`}
                style={{ minWidth: '100px', minHeight: multiline ? '60px' : 'auto' }}
            />
        );
    }

    return (
        <span
            onClick={handleStartEdit}
            className={`cursor-text hover:bg-white/5 rounded px-1 py-0.5 transition-colors ${className}`}
            title="Click to edit"
        >
            {value || <span className="text-slate-500 italic">{placeholder}</span>}
        </span>
    );
};

interface InlineSelectProps {
    value: string;
    options: Array<{ id: string; label: string; color?: string }>;
    onSave: (newValue: string) => void;
    className?: string;
}

export const InlineSelect: React.FC<InlineSelectProps> = ({
    value,
    options,
    onSave,
    className = '',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const currentOption = options.find(opt => opt.id === value) || options[0];

    const handleSelect = (optionId: string) => {
        if (optionId !== value) {
            onSave(optionId);
        }
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
                style={currentOption.color ? { color: currentOption.color } : {}}
            >
                <span className="text-xs font-medium">{currentOption.label}</span>
                <span className="text-[10px] opacity-50">▼</span>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[#1a0a0a] border border-white/10 rounded-lg shadow-xl z-50 min-w-[120px] max-h-[200px] overflow-y-auto">
                    {options.map(option => (
                        <button
                            key={option.id}
                            onClick={() => handleSelect(option.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 rounded transition-colors text-left ${option.id === value ? 'bg-red-500/20' : ''
                                }`}
                            style={option.color ? { color: option.color } : {}}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

interface InlineDatePickerProps {
    value: Date | null;
    onSave: (date: Date | null) => void;
    className?: string;
}

export const InlineDatePicker: React.FC<InlineDatePickerProps> = ({
    value,
    onSave,
    className = '',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [tempDate, setTempDate] = useState(value ? value.toISOString().split('T')[0] : '');
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const dateStr = e.target.value;
        setTempDate(dateStr);
        if (dateStr) {
            onSave(new Date(dateStr));
        } else {
            onSave(null);
        }
        setIsOpen(false);
    };

    const formatDate = (date: Date | null): string => {
        if (!date) return 'No date';
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    };

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer text-xs"
            >
                <span>{formatDate(value)}</span>
                <span className="text-[10px] opacity-50">▼</span>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 bg-[#1a0a0a] border border-white/10 rounded-lg shadow-xl z-50 p-3">
                    <input
                        type="date"
                        value={tempDate}
                        onChange={handleDateChange}
                        className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-slate-300 [color-scheme:dark] focus:border-red-500/50 outline-none"
                        aria-label="Select due date"
                        title="Select due date"
                    />
                    <button
                        onClick={() => {
                            onSave(null);
                            setIsOpen(false);
                        }}
                        className="w-full mt-2 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    >
                        Clear Date
                    </button>
                </div>
            )}
        </div>
    );
};
