import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted rather than CDN-loaded: the van may have no internet at all, and
// a fallback font reflows every telemetry digit on screen.
import '@fontsource-variable/inter'
import '@/index.css'

import App from '@/App'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
