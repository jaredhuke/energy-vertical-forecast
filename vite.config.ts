import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base is relative so the built app also works when served from a
// git.epam.com Pages subpath (e.g. /energy-vertical-forecast/).
export default defineConfig({
  plugins: [react()],
  base: './',
  // host: true binds all interfaces (not IPv6-only localhost), so port
  // health-probes (e.g. ORBIT's stand-up detector) and other machines see it.
  server: { host: true, port: 3120 },
})
