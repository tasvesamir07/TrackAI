/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
            },
            fontSize: {
                'display': ['3rem', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
                'h1': ['1.875rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
                'h2': ['1.5rem', { lineHeight: '1.3', fontWeight: '600' }],
                'h3': ['1.125rem', { lineHeight: '1.4', fontWeight: '600' }],
                'body': ['0.875rem', { lineHeight: '1.6' }],
                'small': ['0.75rem', { lineHeight: '1.5' }],
            },
            borderRadius: {
                'sm': '6px',
                'DEFAULT': '8px',
                'lg': '12px',
                'xl': '16px',
            },
            colors: {
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    hover: 'hsl(var(--primary-hover))',
                    light: 'hsl(var(--primary-light))',
                    foreground: 'hsl(var(--primary-foreground))',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    light: 'hsl(var(--secondary-light))',
                    foreground: 'hsl(var(--secondary-foreground))',
                },
                success: {
                    DEFAULT: 'hsl(var(--success))',
                    light: 'hsl(var(--success-light))',
                },
                warning: {
                    DEFAULT: 'hsl(var(--warning))',
                    light: 'hsl(var(--warning-light))',
                },
                error: {
                    DEFAULT: 'hsl(var(--error))',
                    light: 'hsl(var(--error-light))',
                },
                info: {
                    DEFAULT: 'hsl(var(--info))',
                    light: 'hsl(var(--info-light))',
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--error))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                chart: {
                    1: "hsl(var(--chart-1))",
                    2: "hsl(var(--chart-2))",
                    3: "hsl(var(--chart-3))",
                    4: "hsl(var(--chart-4))",
                    5: "hsl(var(--chart-5))",
                },
            },
            boxShadow: {
                'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                'DEFAULT': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
                'md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                'glow': '0 0 20px hsl(var(--primary) / 0.25)',
                'glow-success': '0 0 20px hsl(var(--success) / 0.25)',
                'glow-error': '0 0 20px hsl(var(--error) / 0.25)',
            },
            spacing: {
                '18': '4.5rem',
                '88': '22rem',
            },
            transitionTimingFunction: {
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.2s ease-out',
                'slide-down': 'slideDown 0.2s ease-out',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideDown: {
                    '0%': { transform: 'translateY(-10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
}