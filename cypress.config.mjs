import { defineConfig } from 'cypress';

// End-to-end tests run against `npm start` (server.js on port 3000). See docs/ci.md.
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: false,
    video: false,
  },
});
