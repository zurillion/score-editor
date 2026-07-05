import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built app can be served from any sub-path.
// The /api backend is a Netlify Function: `netlify dev` wires it up itself;
// set API_PROXY to point a plain `vite dev` at an API served elsewhere.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: process.env.API_PROXY ? { proxy: { '/api': process.env.API_PROXY } } : undefined,
});
