/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // HDB brand colors
        hdb: {
          primary: '#2563eb',
          'primary-dark': '#1d4ed8',
          secondary: '#0891b2',
          accent: '#8b5cf6',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          bg: '#f8fafc',
          'bg-card': '#ffffff',
          'bg-elevated': '#f1f5f9',
          border: '#e2e8f0',
          text: '#1e293b',
          'text-muted': '#64748b',
        }
      },
      fontFamily: {
        sans: ['Atkinson', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'hdb-gradient': 'linear-gradient(135deg, #2563eb 0%, #0891b2 100%)',
      },
      boxShadow: {
        'hdb': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
        'hdb-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
    },
  },
  plugins: [],
}