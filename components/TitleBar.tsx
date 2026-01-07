import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';

export const TitleBar: React.FC = () => {
    const [isMaximized, setIsMaximized] = useState(false);
    const isElectron = !!window.electronAPI;

    useEffect(() => {
        if (isElectron) {
            window.electronAPI?.isMaximized().then(setIsMaximized);
        }
    }, [isElectron]);

    const handleMinimize = () => window.electronAPI?.minimize();
    const handleMaximize = async () => {
        await window.electronAPI?.maximize();
        const maximized = await window.electronAPI?.isMaximized();
        setIsMaximized(maximized || false);
    };
    const handleClose = () => window.electronAPI?.close();

    // Don't render in browser mode
    if (!isElectron) return null;

    return (
        <div className="fixed top-0 left-0 right-0 h-10 z-[100] flex items-center justify-between bg-[#0a0505]/95 backdrop-blur-md border-b border-white/5 titlebar-drag-region">
            {/* App branding */}
            <div className="flex items-center gap-3 px-4">
                <img src="/build/icon.png" alt="LiquiTask" className="w-5 h-5 rounded" />
                <span className="text-sm font-semibold text-slate-200 tracking-wide">LiquiTask</span>
            </div>

            {/* Window controls */}
            <div className="flex items-center h-full titlebar-no-drag">
                <button
                    onClick={handleMinimize}
                    className="h-full px-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                    title="Minimize"
                >
                    <Minus size={14} />
                </button>
                <button
                    onClick={handleMaximize}
                    className="h-full px-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Copy size={12} /> : <Square size={12} />}
                </button>
                <button
                    onClick={handleClose}
                    className="h-full px-4 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/80 transition-colors"
                    title="Close"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};
