import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    cloudflare(
      process.env.E2E_STATE_PATH
        ? { persistState: { path: process.env.E2E_STATE_PATH } }
        : undefined,
    ),
  ],
});
