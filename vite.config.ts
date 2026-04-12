import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      // The blocked page is only referenced via web_accessible_resources,
      // so CRXJS does not discover it as an HTML entry automatically.
      // Register it explicitly so production builds bundle its TSX entry
      // instead of shipping raw ./main.tsx in dist/src/blocked/index.html.
      input: {
        blocked: path.resolve(__dirname, 'src/blocked/index.html'),
      },
    },
  },
});
