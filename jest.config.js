/**
 * Unit tests, two projects:
 * - pure-TS modules (API client, reducers) in the node environment
 * - component/structure tests (*.test.tsx) under the jest-expo Android preset,
 *   which mocks the native modules so react-test-renderer can mount RN trees
 *   (regression coverage for device-only defects like issue #13).
 */
module.exports = {
  projects: [
    {
      preset: 'jest-expo/node',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      clearMocks: true,
    },
    {
      preset: 'jest-expo/android',
      testMatch: ['<rootDir>/src/**/*.test.tsx'],
      clearMocks: true,
    },
  ],
};
