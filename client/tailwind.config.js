/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors';

export default {
  content: {
    files: [
      './index.html',
      './src/**/*.{js,ts,jsx,tsx}',
    ],
  },
  theme: {
    extend: {},
    colors: {
      ...colors,
    },
  },
  plugins: [],
};
