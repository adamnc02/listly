import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: '/listly/' — the app is served from a project page at
// https://adamnc02.github.io/listly/, not from a domain root. Every asset
// URL in the built index.html is resolved against it, so getting this wrong
// produces a blank page with 404s for every chunk, and only once deployed.
export default defineConfig({
  base: '/listly/',
  plugins: [react()],
})
