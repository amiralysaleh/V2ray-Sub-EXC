import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Ensures relative paths for GitHub Pages
  define: {
    // This allows the app to access process.env.API_KEY even in a browser environment
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY)
  }
});
