import type React from "react";
import { useEffect, useState } from "react";

export const CelestialBackdrop: React.FC = () => {
  const [hour, setHour] = useState(new Date().getHours());

  useEffect(() => {
    const interval = setInterval(() => {
      setHour(new Date().getHours());
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, []);

  // 6 AM to 6 PM is daytime
  const isDay = hour >= 6 && hour < 18;

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Ambient background wash */}
      <div
        className={`absolute inset-0 transition-colors duration-1000 ${
          isDay ? "bg-sky-900/5" : "bg-slate-950/40"
        }`}
      />

      {isDay ? (
        // Realistic Sun
        <>
          {/* Main big glow */}
          <div className="absolute top-[-20%] right-[-10%] w-[1200px] h-[1200px] bg-amber-500/20 rounded-full blur-[150px] animate-pulse-slow" />

          {/* Core sun body */}
          <div className="absolute top-[5%] right-[10%] w-[150px] h-[150px] bg-gradient-to-br from-white via-yellow-100 to-amber-300 rounded-full blur-[2px] shadow-[0_0_120px_60px_rgba(251,191,36,0.6)] mix-blend-screen" />

          {/* Sun rays/flare diffusers */}
          <div className="absolute top-[5%] right-[10%] w-[250px] h-[250px] bg-yellow-400/30 rounded-full blur-[40px] mix-blend-screen" />

          {/* Additional diffracted light source for glass effect */}
          <div className="absolute top-[10%] right-[15%] w-[400px] h-[400px] bg-orange-400/10 rounded-full blur-[80px] mix-blend-screen" />
        </>
      ) : (
        // Realistic Moon
        <>
          {/* Main big night glow */}
          <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-500/10 rounded-full blur-[120px] animate-pulse-slow" />

          {/* Core moon body */}
          <div className="absolute top-[10%] left-[15%] w-[120px] h-[120px] bg-gradient-to-br from-slate-100 via-slate-300 to-slate-500 rounded-full shadow-[0_0_100px_30px_rgba(199,210,254,0.4)] mix-blend-screen overflow-hidden">
            {/* Moon craters (subtle) */}
            <div className="absolute top-[20%] left-[30%] w-8 h-8 rounded-full bg-black/10 blur-[2px]" />
            <div className="absolute top-[60%] left-[60%] w-12 h-12 rounded-full bg-black/15 blur-[3px]" />
            <div className="absolute top-[40%] left-[10%] w-6 h-6 rounded-full bg-black/10 blur-[1px]" />
          </div>

          {/* Moon halo */}
          <div className="absolute top-[10%] left-[15%] w-[200px] h-[200px] bg-blue-300/20 rounded-full blur-[30px] mix-blend-screen" />

          {/* Additional diffracted light source for glass effect */}
          <div className="absolute top-[15%] left-[20%] w-[350px] h-[350px] bg-indigo-400/10 rounded-full blur-[60px] mix-blend-screen" />
        </>
      )}
    </div>
  );
};
