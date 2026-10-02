import { defineConfig } from 'vite'

// requests to /api are forwarded to the Flask dev server so no CORS setup needed
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5001',
    },
  },
})
