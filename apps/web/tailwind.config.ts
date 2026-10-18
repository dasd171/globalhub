import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: { 50: '#fff1f1', 100: '#ffe0e0', 500: '#d7263d', 600: '#b81d33', 700: '#94172a' }, ink: { 900: '#14171f', 700: '#3b4252', 500: '#6b7280' } },
      fontFamily: { sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
