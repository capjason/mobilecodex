import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_DEV_BACKEND_URL || 'http://127.0.0.1:8787';
  return {
    plugins: [react()],
    server: {
      host: env.VITE_DEV_HOST || '0.0.0.0',
      port: Number(env.VITE_DEV_PORT || 5174),
      proxy: {
        '/api': backendUrl,
        '/ws': {
          target: backendUrl.replace(/^http/, 'ws'),
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist'
    }
  };
});
