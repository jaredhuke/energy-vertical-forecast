import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base is relative so the built app also works when served from a
// git.epam.com Pages subpath (e.g. /energy-vertical-forecast/).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 3120 },
})
