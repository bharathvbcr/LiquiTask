import type React from "react";

export const LiquidCardBlob: React.FC = () => (
  <div className="liquid-card-blobs pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
    <div className="liquid-card-blob liquid-card-blob--base" />
    <div className="liquid-card-blob liquid-card-blob--secondary" />
    <div className="liquid-card-blob liquid-card-blob--primary" />
    <div className="liquid-card-blob liquid-card-blob--specular" />
    <div className="liquid-card-blob liquid-card-blob--droplet" />
    <div className="liquid-card-blob liquid-card-blob--droplet liquid-card-blob--droplet-trail" />
  </div>
);
