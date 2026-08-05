/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'components/**/*.tsx'],
      exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
})
