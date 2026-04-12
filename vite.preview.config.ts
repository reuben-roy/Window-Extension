// Lightweight preview-only config — no crxjs, no extension build.
// Used to preview UI pages in isolation with chrome API mocks.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: { port: 5175 },
});
