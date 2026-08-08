import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // .tsx as well, so pages can be rendered to markup and read back. No jsdom:
    // react-dom/server is enough to prove a page renders and to check its copy.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
