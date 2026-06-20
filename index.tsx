import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { KeybindingProvider } from "./src/context/KeybindingContext";
import { ConfirmationProvider } from "./src/contexts/ConfirmationContext";
import "./index.css";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import {
  getRuntimeWindowControls,
  initializeDesktopBridge,
  showRuntimeWindow,
} from "./src/runtime/runtimeEnvironment";

const bootstrap = async () => {
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
      <KeybindingProvider>
        <ConfirmationProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ConfirmationProvider>
      </KeybindingProvider>
    </React.StrictMode>,
  );

  await showRuntimeWindow();
};

bootstrap().catch(console.error);
