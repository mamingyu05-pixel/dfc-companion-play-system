module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  testTimeout: 30000,
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }] },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@dfc/shared$': '<rootDir>/../../packages/shared/src',
    '^@dfc/auth$': '<rootDir>/../../packages/auth/src',
    '^@dfc/config$': '<rootDir>/../../packages/config/src',
    '^@dfc/database$': '<rootDir>/../../packages/database/src'
  }
};
