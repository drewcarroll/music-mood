import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { authTokenPlugin } from './server/viteAuthTokenPlugin';

// https://vitejs.dev/config/
export default defineConfig({
  // authTokenPlugin serves the ephemeral-token endpoint (`/api/auth-token`)
  // during dev/preview so the real key can stay server-side. See server/.
  plugins: [react(), authTokenPlugin()],
  resolve: {
    alias: {
      '@domain': fileURLToPath(new URL('./src/domain', import.meta.url)),
      '@application': fileURLToPath(new URL('./src/application', import.meta.url)),
      '@infrastructure': fileURLToPath(new URL('./src/infrastructure', import.meta.url)),
      '@interfaces': fileURLToPath(new URL('./src/interfaces', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // AudioWorklet + SharedArrayBuffer-friendly headers (optional but recommended)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
