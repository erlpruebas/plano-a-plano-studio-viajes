import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The Codex in-app browser reaches localhost over IPv4.
    host: '127.0.0.1',
    port: 5173,
  },
})
