import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://kirbygmod-stack.github.io/workout-log/
export default defineConfig({
  base: '/workout-log/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Logbook',
        short_name: 'Logbook',
        description: 'Personal workout logger',
        theme_color: '#0f1218',
        background_color: '#0f1218',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/workout-log/',
        scope: '/workout-log/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
      },
    }),
  ],
})
