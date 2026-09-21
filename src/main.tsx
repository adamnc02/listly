import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/push'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Push notifications only — the worker has no fetch handler and caches
// nothing, so it cannot pin an old build (public/sw.js).
registerServiceWorker()
