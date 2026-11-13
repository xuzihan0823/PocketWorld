import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  publicDir: 'assets/public',
  plugins: [react()],
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\', '/');
          if (path.includes('commonjsHelpers') || path.includes('vite/preload-helper') || /\/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react-vendor';
          if (/\/node_modules\/(three|three-stdlib|@react-three\/fiber|@react-three\/drei)\//.test(path)) return 'three-vendor';
          if (/\/node_modules\/gsap\//.test(path)) return 'gsap-vendor';
        },
      },
    },
  },
});
