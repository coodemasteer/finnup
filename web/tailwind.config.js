/** @type {import('tailwindcss').Config} */
const path = require('path')
// Convert to forward slashes for glob compatibility on Windows
const webDir = __dirname.replace(/\\/g, '/')

module.exports = {
  content: [
    `${webDir}/pages/**/*.{js,ts,jsx,tsx,mdx}`,
    `${webDir}/components/**/*.{js,ts,jsx,tsx,mdx}`,
    `${webDir}/app/**/*.{js,ts,jsx,tsx,mdx}`,
  ],
  theme: {
    extend: {
      colors: {
        navy:  '#1B3A6B',
        teal:  '#0D9488',
        amber: '#F59E0B',
        green: '#16A34A',
        red:   '#EF4444',
        muted: '#94A3B8',
      },
    },
  },
  plugins: [],
}
