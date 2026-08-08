import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * The `@/` alias is declared here AND in tsconfig.app.json. Change one and you
 * must change the other — Vite resolves at build time, tsc at check time, and
 * they do not read each other's config.
 */
// Temporary testing (../temptest). The path is computed, not required to exist:
// if the folder is deleted the dev import just 404s and the double-tap-T
// gesture goes inert. See web/src/dev/tempTest.ts and temptest/README.md.
const temptestSim = fileURLToPath(new URL('../temptest/sim.ts', import.meta.url))
const modelLab = fileURLToPath(new URL('../temptest/model-lab.html', import.meta.url))
const sampleFrame = fileURLToPath(new URL('../temptest/sample-pipe.jpg', import.meta.url))

/**
 * The simulator shims fetch and WebSocket, but images are <img> loads the fetch
 * shim can't cover: the live camera (/api/camera) and each snapshot
 * (/api/runs/<id>/snapshots/<file>). This dev-only middleware answers both with
 * a still sample pipe frame, so test mode shows real images instead of "no
 * camera feed" and a camera roll full of blanks.
 *
 * Same-origin only: in test mode the console talks to localhost, so this fires;
 * a real robot lives at another origin and is untouched. `apply: 'serve'` keeps
 * it out of the production build, so it never reaches the Pi. If the temptest
 * folder (and its frame) is deleted, the read fails and it falls through.
 */
function simMediaPlugin(): Plugin {
  const wantsFrame = (url: string) => {
    const path = url.split('?')[0]
    return path === '/api/camera' || /^\/api\/runs\/[^/]+\/snapshots\/[^/]+$/.test(path)
  }
  return {
    name: 'temptest-sim-media',
    apply: 'serve',
    configureServer(server) {
      // The model lab: /model-lab, straight out of temptest. It exists because
      // the console can only show detections inside a run, and a run needs
      // preflight, which needs hardware a laptop does not have — so there was
      // no way to answer "does the model work" without a robot.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== '/model-lab') return next()
        try {
          const page = await readFile(modelLab)
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(page)
        } catch {
          next()
        }
      })

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !wantsFrame(req.url)) return next()
        try {
          const frame = await readFile(sampleFrame)
          res.setHeader('Content-Type', 'image/jpeg')
          res.setHeader('Cache-Control', 'no-store')
          res.end(frame)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), simMediaPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Injected into the dev-only loader. In production this is dead code the build
  // strips, so the simulator never reaches the Pi.
  define: { __TEMPTEST_URL__: JSON.stringify(`/@fs${temptestSim}`) },
  server: {
    // Let the dev server serve ../temptest, which sits outside web/.
    fs: { allow: ['..'] },
  },
  build: {
    // The server serves this directory. config.py's WEB_DIST points at it.
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
