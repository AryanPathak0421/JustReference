import { defineConfig } from '@playwright/test';

/**
 * Browser smoke tests against the local dev stack (web :5173 → API :4000 → MongoDB :27117).
 * Start `npm run db -w @jr/api`, `npm run dev -w @jr/api` and `npm run dev` first (or let webServer start the web app).
 * Tests create users with unique @example.test emails in the dev database.
 * Uses the installed Microsoft Edge (no browser download).
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    cwd: '..',
    timeout: 60_000,
  },
});
