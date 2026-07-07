import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { KeybindingProvider } from "./src/context/KeybindingContext";
import { ConfirmationProvider } from "./src/contexts/ConfirmationContext";
import { queryClient } from "./src/core/queryClient";
import "./index.css";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import {
  getRuntimeWindowControls,
  initializeDesktopBridge,
  showRuntimeWindow,
} from "./src/runtime/runtimeEnvironment";
import { applyGpuTier } from "./src/utils/gpuDetection";

const bootstrap = async () => {
  applyGpuTier();
  initializeDesktopBridge();

  const runtimeWindowControls = getRuntimeWindowControls();
  if (runtimeWindowControls) {
    runtimeWindowControls.onWindowStateChange((isMaximized) => {
      if (isMaximized) {
        document.body.classList.add("maximized");
      } else {
        document.body.classList.remove("maximized");
      }
    });
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <KeybindingProvider>
          <ConfirmationProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </ConfirmationProvider>
        </KeybindingProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );

  await showRuntimeWindow();
};

bootstrap().catch(console.error);
