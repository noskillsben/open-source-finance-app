/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    // The Visual design tokens (DESIGN.md § UI conventions → Visual design) are the whole palette:
    // nothing else in the frontend holds a colour, and no hex appears in JSX.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      page: '#111315',
      surface: '#191C1F',
      raised: '#22262A',
      line: '#30353A',
      'field-line': '#6B737B',
      text: { DEFAULT: '#ECEEF0', 2: '#B3BAC2', 3: '#8C949C' },
      accent: '#7DB4FF',
      'on-accent': '#0C1622',
      negative: '#FF8A8A',
      warning: '#F2C35B',
      positive: '#6AD7A4',
    },
    fontFamily: {
      sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
    },
    extend: {
      // The type scale, in rem so the app follows the browser's text-size setting.
      fontSize: {
        headline: ['2.5rem', { lineHeight: '1.1', fontWeight: '600' }],
        title: ['1.75rem', { lineHeight: '1.2', fontWeight: '600' }],
        section: ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        label: ['0.8125rem', { lineHeight: '1.2', letterSpacing: '0.06em', fontWeight: '600' }],
      },
      // Room for the phone's home indicator under the bottom bar.
      spacing: {
        bar: 'calc(4rem + env(safe-area-inset-bottom))',
      },
    },
  },
  plugins: [],
}
