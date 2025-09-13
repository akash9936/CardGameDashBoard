// Jest setup file for Card Game tests
// This file runs before each test file

// Global test setup
global.console = {
    ...console,
    // Suppress console.warn during tests
    warn: jest.fn(),
    // Keep other console methods for debugging
    log: console.log,
    error: console.error,
    info: console.info,
};

// Mock global objects that might be used by the application
global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
};

global.sessionStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
};

// Mock Date to have consistent timestamps in tests
global.Date.now = jest.fn(() => new Date('2023-01-01T00:00:00.000Z').getTime());

// Load the classes that need to be tested
// Note: In Node.js environment, we need to require the classes
// since they're not automatically available like in browser

// Load Team and TeamService classes for testing
const path = require('path');
const fs = require('fs');

// Function to load a JavaScript file as a module in Node.js
function loadJSFile(filePath) {
    const fullPath = path.resolve(__dirname, '..', filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    
    // Wrap the content in a function to create a module-like environment
    const wrappedContent = `
        (function(exports, require, module, __filename, __dirname) {
            ${content}
            // Export classes/functions for Node.js
            if (typeof Team !== 'undefined') global.Team = Team;
            if (typeof TeamService !== 'undefined') global.TeamService = TeamService;
            if (typeof Match !== 'undefined') global.Match = Match;
            if (typeof MatchService !== 'undefined') global.MatchService = MatchService;
        })
    `;
    
    // Execute the wrapped content
    const moduleWrapper = eval(wrappedContent);
    const fakeModule = { exports: {} };
    const fakeRequire = require;
    
    moduleWrapper(fakeModule.exports, fakeRequire, fakeModule, fullPath, path.dirname(fullPath));
    
    return fakeModule.exports;
}

// Load required classes
try {
    loadJSFile('js/models/Team.js');
    loadJSFile('js/services/teamService.js');
} catch (error) {
    console.warn('Could not load some application files for testing:', error.message);
}

// Jest matchers setup
expect.extend({
    toBeValidTeam(received) {
        const pass = received && 
                    typeof received.id === 'string' &&
                    typeof received.name === 'string' &&
                    Array.isArray(received.members) &&
                    received.stats &&
                    Array.isArray(received.matchHistory);
        
        if (pass) {
            return {
                message: () => `expected ${received} not to be a valid team`,
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${received} to be a valid team with id, name, members, stats, and matchHistory`,
                pass: false,
            };
        }
    },
});

// Clean up after each test
afterEach(() => {
    jest.clearAllMocks();
});