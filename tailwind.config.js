/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2a4a82',
          50: '#f4f6f9',
          100: '#e9edf2',
          200: '#c7d1e0',
          300: '#a5b5cd',
          400: '#627da9',
          500: '#2a4a82',
          600: '#264375',
          700: '#203862',
          800: '#192c4e',
          900: '#152440',
        }
      }
    },
  },
  plugins: [],
}
