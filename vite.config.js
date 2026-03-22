import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      '@livekit/components-react',
      '@livekit/components-core',
      'livekit-client',
    ],
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('livekit')) return 'livekit';
          if (id.includes('firebase')) return 'firebase';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
})