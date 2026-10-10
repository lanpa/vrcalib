import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://localhost:${PORT}/vrcalib/` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/vrcalib/`,
    reuseExistingServer: !process.env.CI,
    // Talk to the local Firebase emulators, never the real project.
    // `npm run test:e2e` starts them (firebase emulators:exec).
    env: { VITE_FIREBASE_EMULATOR: '1' },
  },
});
