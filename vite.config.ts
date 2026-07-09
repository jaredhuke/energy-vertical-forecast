import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// SHARE=1 → inline all JS/CSS into one self-contained index.html (works by
// double-click / file:// and any static host; seed data is bundled, not fetched).
const share = process.env.SHARE === '1'

// Base is relative so the built app also works when served from a
// git.epam.com Pages subpath (e.g. /energy-vertical-forecast/) or file://.
export default defineConfig({
  plugins: [react(), ...(share ? [viteSingleFile()] : [])],
  base: './',
  // host: true binds all interfaces (not IPv6-only localhost), so port
  // health-probes (e.g. ORBIT's stand-up detector) and other machines see it.
  server: { host: true, port: 3120 },
  build: share ? { outDir: 'dist-share' } : {},
})
