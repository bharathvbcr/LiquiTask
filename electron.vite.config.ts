import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    main: {
        build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
                input: resolve(__dirname, 'electron/main.ts')
            }
        }
    },
    preload: {
        build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
                input: resolve(__dirname, 'electron/preload.ts'),
                output: {
                    format: 'cjs',
                    entryFileNames: 'preload.js'
                }
            }
        }
    },
    renderer: {
        root: '.',
        server: {
            port: 5173,
            host: '0.0.0.0',
            strictPort: false,
            hmr: {
                protocol: 'ws',
                host: 'localhost'
            }
        },
        build: {
            outDir: 'dist-electron/renderer',
            rollupOptions: {
                input: resolve(__dirname, 'index.html')
            }
        },
        plugins: [react({
            jsxRuntime: 'automatic',
            jsxImportSource: 'react'
        })],
        resolve: {
            alias: {
                '@': resolve(__dirname, '.')
            }
        }
    }
});
