import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Flag,
  Flame,
  Minus,
  Shield,
  Star,
  Zap,
} from "lucide-react";
import React from "react";

export const getDueDateStatus = (dueDate?: Date) => {
  if (!dueDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0)
    return {
      status: "overdue",
      label: `${Math.abs(diffDays)}d overdue`,
      color: "text-red-400 font-bold",
    };
  if (diffDays === 0)
    return {
      status: "today",
      label: "Due Today",
      color: "text-amber-400 font-bold",
    };
  if (diffDays === 1)
    return {
      status: "tomorrow",
      label: "Due Tomorrow",
      color: "text-blue-300",
    };

  return {
    status: "future",
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(due),
    color: "text-slate-400",
  };
};

export const getPriorityIcon = (iconName?: string, size = 12) => {
  switch (iconName) {
    case "alert-circle":
      return React.createElement(AlertCircle, { size });
    case "clock":
      return React.createElement(Clock, { size });
    case "arrow-down":
      return React.createElement(ArrowDown, { size });
    case "arrow-up":
      return React.createElement(ArrowUp, { size });
    case "zap":
      return React.createElement(Zap, { size });
    case "star":
      return React.createElement(Star, { size });
    case "shield":
      return React.createElement(Shield, { size });
    case "flame":
      return React.createElement(Flame, { size });
    case "alert-triangle":
      return React.createElement(AlertTriangle, { size });
    case "flag":
      return React.createElement(Flag, { size });
    case "minus":
      return React.createElement(Minus, { size });
    default:
      return null;
  }
};

export const getProgressStyles = (percent: number) => {
  if (percent === 100)
    return "bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)]";
  if (percent >= 66)
    return "bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]";
  if (percent >= 33)
    return "bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_12px_rgba(245,158,11,0.5)]";
  return "bg-gradient-to-r from-red-500 to-pink-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]";
};
