// Environment Variables Loader
// This file loads environment variables for the application
// In production, these should be set as actual environment variables

// Parse .env file content
function parseEnvFile(content) {
    const env = {};
    const lines = content.split('\n');
    
    lines.forEach(line => {
        // Skip comments and empty lines
        if (line.startsWith('#') || line.trim() === '') return;
        
        // Parse key=value pairs
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim();
            // Remove quotes if present
            env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
    
    return env;
}

// Load environment variables
async function loadEnvironmentVariables() {
    try {
        // Try to fetch .env file
        const response = await fetch('/.env');
        if (response.ok) {
            const content = await response.text();
            const envVars = parseEnvFile(content);
            
            // Make environment variables available globally
            window.env = envVars;
            console.log('✅ Environment variables loaded from .env file');
            return true;
        } else {
            console.log('ℹ️ No .env file found, using environment variables or defaults');
            return false;
        }
    } catch (error) {
        console.log('ℹ️ Could not load .env file, using environment variables or defaults');
        return false;
    }
}

// Function to get environment variable with fallback
function getEnvVar(key, fallback = null) {
    // Try to get from window.env (set by env.js)
    if (window.env && window.env[key]) {
        console.log(`✅ Environment variable ${key} loaded from .env file`);
        return window.env[key];
    }
    
    // Try to get from process.env (for Node.js environments)
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
        console.log(`✅ Environment variable ${key} loaded from process.env`);
        return process.env[key];
    }
    
    // Return fallback
    if (fallback !== null) {
        console.log(`⚠️ Environment variable ${key} not found, using fallback`);
    }
    return fallback;
}

// Load environment variables when the script loads
loadEnvironmentVariables().then(() => {
    console.log('🌍 Environment variables loaded');
    console.log('📝 To configure environment variables:');
    console.log('   1. Copy env.example to .env');
    console.log('   2. Set FIREBASE_API_KEY=your_firebase_key');
    console.log('   3. Set AUTH_KEY=your_secure_auth_key');
});

// Export for use in other modules
window.getEnvVar = getEnvVar; 