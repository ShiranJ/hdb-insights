/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        // HDB brand colors - "Enterprise Modern" Palette
        hdb: {
          primary: '#3b82f6', // Electric Blue (Blue-500)
          'primary-dark': '#1d4ed8', // (Blue-700)
          secondary: '#6366f1', // Indigo-500
          accent: '#8b5cf6', // Violet-500
          success: '#10b981', // Emerald-500
          warning: '#f59e0b', // Amber-500
          danger: '#ef4444', // Red-500

          // Surface colors
          bg: '#fafafa', // Warm Gray-50 (Light mode bg)
          'bg-card': '#ffffff', // (Light mode card)
          'bg-elevated': '#f4f4f5', // Zinc-100
          border: '#e4e4e7', // Zinc-200
          text: '#18181b', // Zinc-900
          'text-muted': '#71717a', // Zinc-500

          // Dark mode specific (handled via CSS variables or utility classes usually, 
          // but defining here for explicit usage if needed)
          dark: {
            bg: '#0f172a', // Slate-900
            'bg-card': '#1e293b', // Slate-800
            border: '#334155', // Slate-700
            text: '#f8fafc', // Slate-50
          }
        }
      },
      fontFamily: {
        sans: ['Atkinson', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hdb-gradient': 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)', // Electric Blue -> Indigo
        'hdb-mesh': 'radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.15) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%)',
      },
      boxShadow: {
        'hdb': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
        'hdb-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.08)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}