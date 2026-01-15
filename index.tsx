import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './src/context/AppContext';
import { KeybindingProvider } from './src/context/KeybindingContext';
import { ConfirmationProvider } from './src/contexts/ConfirmationContext';
import './index.css';

// Handle window controls for electron
if (window.electronAPI) {
    window.electronAPI.on('maximize', () => document.body.classList.add('maximized'));
    window.electronAPI.on('unmaximize', () => document.body.classList.remove('maximized'));
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <KeybindingProvider>
            <AppProvider>
                <ConfirmationProvider>
                    <App />
                </ConfirmationProvider>
            </AppProvider>
        </KeybindingProvider>
    </React.StrictMode>,
);