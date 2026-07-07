export type GpuTier = "full" | "reduced";

const MANUAL_OVERRIDE_KEY = "liquitask:reduce-visual-effects";

/** User-forced override from Settings > Appearance, independent of auto-detection. */
export function getManualReducedEffectsPreference(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(MANUAL_OVERRIDE_KEY) === "1";
}

export function setManualReducedEffectsPreference(reduced: boolean): GpuTier {
  if (reduced) {
    localStorage.setItem(MANUAL_OVERRIDE_KEY, "1");
  } else {
    localStorage.removeItem(MANUAL_OVERRIDE_KEY);
  }
  return applyGpuTier();
}

const SOFTWARE_RENDERER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /software rasterizer/i,
  /microsoft basic render/i,
  /apple software renderer/i,
  /d3d11 warp/i,
];

let cachedTier: GpuTier | null = null;

export function detectGpuTier(): GpuTier {
  if (cachedTier) return cachedTier;
  if (typeof document === "undefined") return "full";

  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);

    if (!gl) {
      cachedTier = "reduced";
      return cachedTier;
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );

    cachedTier = SOFTWARE_RENDERER_PATTERNS.some((pattern) => pattern.test(renderer))
      ? "reduced"
      : "full";

    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Fail open: an unexpected error here says more about the check than the GPU.
    cachedTier = "full";
  }

  return cachedTier;
}

export function applyGpuTier(): GpuTier {
  const tier = getManualReducedEffectsPreference() ? "reduced" : detectGpuTier();
  document.documentElement.dataset.gpuTier = tier;
  return tier;
}
