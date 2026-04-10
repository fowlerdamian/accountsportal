/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1100px' },
    },
    extend: {
      fontFamily: {
        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
        heading: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        body: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        'status-urgent': 'hsl(var(--status-urgent))',
        'status-warning': 'hsl(var(--status-warning))',
        'status-progress': 'hsl(var(--status-progress))',
        'status-resolved': 'hsl(var(--status-resolved))',
        'status-neutral': 'hsl(var(--status-neutral))',
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        surface: 'hsl(var(--surface))',
        'surface-elevated': 'hsl(var(--surface-elevated))',
        'border-hover': 'hsl(var(--border-hover))',
        // Design system direct tokens
        cat: {
          1: '#f3ca0f', 2: '#4fc3f7', 3: '#ef5350', 4: '#66bb6a',
          5: '#ab47bc', 6: '#ff7043', 7: '#26c6da', 8: '#ec407a',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        'page-title': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'section': ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        'card-title': ['0.9375rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '500' }],
        'body': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.02em', fontWeight: '400' }],
        'label': ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.05em', fontWeight: '500' }],
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
  ],
}
