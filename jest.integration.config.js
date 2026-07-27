/**
 * Integration tests: boot the contract package's mock agent and exercise the
 * API client against it over real HTTP. Run via `npm run test:integration`.
 */
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
  testTimeout: 30000,
  clearMocks: true,
};
