module.exports = {
    // Test environment
    testEnvironment: 'node',
    
    // Test files pattern
    testMatch: [
        '<rootDir>/tests/**/*.test.js'
    ],
    
    // Setup files to run before tests
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    
    // Coverage collection
    collectCoverageFrom: [
        'js/**/*.js',
        '!js/utils/firebaseConfig.js', // Exclude config files
        '!**/node_modules/**'
    ],
    
    // Coverage thresholds
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    
    // Module paths
    moduleDirectories: ['node_modules', '<rootDir>'],
    
    // Clear mocks between tests
    clearMocks: true,
    
    // Verbose output
    verbose: true
};