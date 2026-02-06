/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gb-darkest': 'rgb(15, 56, 15)',
        'gb-dark': 'rgb(48, 98, 48)',
        'gb-light': 'rgb(139, 172, 15)',
        'gb-lightest': 'rgb(155, 188, 15)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
