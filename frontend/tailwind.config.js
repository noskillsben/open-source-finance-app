/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Design tokens live here and nowhere else. No hex in JSX; charts import from src/utils/colors.js (later).
      colors: {
        ink: { DEFAULT: '#0f172a', soft: '#1e293b' },
        paper: { DEFAULT: '#f8fafc', soft: '#e2e8f0' },
        accent: { DEFAULT: '#6366f1', soft: '#a5b4fc' },
        ok: '#16a34a',
        warn: '#d97706',
        bad: '#dc2626',
      },
    },
  },
  plugins: [],
}
