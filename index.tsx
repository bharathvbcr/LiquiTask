import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { KeybindingProvider } from './src/context/KeybindingContext';
import { ConfirmationProvider } from './src/contexts/ConfirmationContext';
import './index.css';
import { getRuntimeWindowControls } from './src/runtime/runtimeEnvironment';
import { initializeElectrobunBridge } from './src/runtime/electrobunBridge';

const bootstrap = async () => {
    await initializeElectrobunBridge();

    const runtimeWindowControls = getRuntimeWindowControls();
    if (runtimeWindowControls) {
        runtimeWindowControls.onWindowStateChange((isMaximized) => {
            if (isMaximized) {
                document.body.classList.add('maximized');
            } else {
                document.body.classList.remove('maximized');
            }
        });
    }

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
        <React.StrictMode>
            <KeybindingProvider>
                <ConfirmationProvider>
                    <App />
                </ConfirmationProvider>
            </KeybindingProvider>
        </React.StrictMode>,
    );
};

bootstrap().catch((error) => {
    console.error('Failed to bootstrap LiquiTask runtime', error);
});
