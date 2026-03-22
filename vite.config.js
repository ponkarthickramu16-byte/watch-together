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
    force: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          livekit: ['@livekit/components-react', 'livekit-client'],
          firebase: ['firebase/app', 'firebase/firestore', 'firebase/auth'],
        },
      },
    },
  },
})