import { defineConfig } from 'vitest/config'

// Dates in the app follow the phone's local calendar, so tests pin a fixed zone (one with daylight saving).
process.env.TZ = 'America/New_York'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
