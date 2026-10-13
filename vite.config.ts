import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Only VITE_-prefixed variables reach the bundle. Never prefix a secret with VITE_.
  envPrefix: 'VITE_',
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
