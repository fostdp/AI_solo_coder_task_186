import { defineConfig } from 'vite';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  root: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      }
    },
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('js/app')) {
            return 'app';
          }
          return 'main';
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  esbuild: {
    maxWorkers: 4,
    target: 'es2015',
    drop: ['debugger']
  },
  optimizeDeps: {
    noDiscovery: true
  },
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
      polyfills: ['es.promise', 'es.array.iterator']
    })
  ]
});
