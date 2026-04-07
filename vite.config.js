import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Support Hub — @/ resolves to its own src tree
      '@': path.resolve(__dirname, './src/apps/Support'),
      // Guide Portal — components/ was copied flat into Guide/, so map it back
      '@guide/components': path.resolve(__dirname, './src/apps/Guide'),
      '@guide': path.resolve(__dirname, './src/apps/Guide'),
    },
  },
})
