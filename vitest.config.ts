import { defineConfig } from 'vitest/config';

// The simulation core is plain TypeScript with no DOM or three.js dependency,
// so its tests run in Node, fast.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
