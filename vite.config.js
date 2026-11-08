import { defineConfig } from 'vite';

// Everything in ./models (GLBs, models.json, parts/*.json) is served at the site root.
export default defineConfig({
  publicDir: 'models',
  base: './',
  server: { open: false },
});
