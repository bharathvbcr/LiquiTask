import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Clock, Save } from 'lucide-react';
import { useTimer, formatMinutes, secondsToMinutes } from '../hooks/useTimer';
import { Task } from '../../types';

interface TimeTrackerProps {
    task: Task;
    onSaveTime: (taskId: string, timeSpent: number) => void;
    isCompact?: boolean;
}

export const TimeTracker: React.FC<TimeTrackerProps> = ({
    task,
    onSaveTime,
    isCompact = false,
}) => {
    // Convert existing time spent (minutes) to seconds for initial value
    const initialSeconds = (task.timeSpent || 0) * 60;

    const { seconds, isRunning, start, pause, reset, formattedTime } = useTimer({
        initialSeconds,
        autoSaveInterval: 60, // Auto-save every minute
        onAutoSave: (secs) => {
            onSaveTime(task.id, secondsToMinutes(secs));
        },
    });

    const handleSave = () => {
        onSaveTime(task.id, secondsToMinutes(seconds));
    };

    const handleReset = () => {
        if (window.confirm('Reset timer to 0? This cannot be undone.')) {
            reset();
            onSaveTime(task.id, 0);
        }
    };

    // Calculate progress percentage if estimate exists
    const estimateSeconds = (task.timeEstimate || 0) * 60;
    const progressPercent = estimateSeconds > 0
        ? Math.min((seconds / estimateSeconds) * 100, 100)
        : 0;
    const isOverEstimate = estimateSeconds > 0 && seconds > estimateSeconds;

    if (isCompact) {
        return (
            <div className="flex items-center gap-2">
                <button
                    onClick={isRunning ? pause : start}
                    className={`p-1.5 rounded-lg transition-colors ${isRunning
                            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        }`}
                    title={isRunning ? 'Pause' : 'Start'}
                >
                    {isRunning ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <span className={`font-mono text-xs ${isRunning ? 'text-amber-400' : 'text-slate-400'}`}>
                    {formattedTime}
                </span>
            </div>
        );
    }

    return (
        <div className="bg-black/30 rounded-xl p-4 border border-white/5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                    <Clock size={16} className="text-red-400" />
                    Time Tracker
                </div>
                {task.timeEstimate > 0 && (
                    <div className="text-xs text-slate-500">
                        Est: {formatMinutes(task.timeEstimate)}
                    </div>
                )}
            </div>

            {/* Timer Display */}
            <div className="text-center mb-4">
                <div className={`font-mono text-4xl font-bold tracking-wider ${isRunning
                        ? isOverEstimate ? 'text-red-400' : 'text-emerald-400'
                        : 'text-slate-200'
                    }`}>
                    {formattedTime}
                </div>
                {isRunning && (
                    <div className="text-xs text-slate-500 mt-1 animate-pulse">
                        ● Recording
                    </div>
                )}
            </div>

            {/* Progress Bar (if estimate exists) */}
            {estimateSeconds > 0 && (
                <div className="mb-4">
                    <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-300 ${isOverEstimate
                                    ? 'bg-gradient-to-r from-red-500 to-red-400'
                                    : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                                }`}
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                        <span>0</span>
                        <span>{formatMinutes(task.timeEstimate)}</span>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-center gap-2">
                <button
                    onClick={isRunning ? pause : start}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${isRunning
                            ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                        }`}
                >
                    {isRunning ? <Pause size={16} /> : <Play size={16} />}
                    {isRunning ? 'Pause' : 'Start'}
                </button>

                <button
                    onClick={handleSave}
                    disabled={isRunning}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Save time"
                >
                    <Save size={16} />
                </button>

                <button
                    onClick={handleReset}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Reset timer"
                >
                    <RotateCcw size={16} />
                </button>
            </div>

            {/* Summary */}
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-4 text-center">
                <div>
                    <div className="text-xs text-slate-500 uppercase tracking-wide">Logged</div>
                    <div className="text-sm font-bold text-slate-300">
                        {formatMinutes(secondsToMinutes(seconds))}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-slate-500 uppercase tracking-wide">Remaining</div>
                    <div className={`text-sm font-bold ${isOverEstimate ? 'text-red-400' : 'text-slate-300'}`}>
                        {estimateSeconds > 0
                            ? isOverEstimate
                                ? `+${formatMinutes(secondsToMinutes(seconds - estimateSeconds))}`
                                : formatMinutes(secondsToMinutes(Math.max(0, estimateSeconds - seconds)))
                            : '—'
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TimeTracker;
