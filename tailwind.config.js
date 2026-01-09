/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./App.tsx",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                navy: {
                    900: '#050000',
                    800: '#1a0505',
                    700: '#2d0a0a',
                    600: '#450a0a',
                },
                liquid: {
                    red: '#ff1f1f',
                    dark: '#2a0000',
                }
            },
            boxShadow: {
                'glow-red': '0 0 30px -5px rgba(255, 31, 31, 0.4)',
                'glow-green': '0 0 20px -3px rgba(34, 197, 94, 0.3)',
                'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
                'inner-light': 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.1)',
            },
            animation: {
                'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'ripple': 'viscous-ripple 2s infinite',
            },
            keyframes: {
                'viscous-ripple': {
                    '0%': { transform: 'scale(0.98)', opacity: '0.8' },
                    '50%': { transform: 'scale(1.02)', opacity: '1' },
                    '100%': { transform: 'scale(0.98)', opacity: '0.8' },
                }
            }
        },
    },
    plugins: [],
}
