// Firebase Configuration
// This file reads Firebase configuration from environment variables
// For development: Create a .env file in the project root
// For production: Set environment variables on your hosting platform

// Firebase Configuration from environment variables
const firebaseConfig = {
    apiKey: getEnvVar('FIREBASE_API_KEY'),
    authDomain: "card-game-dashboard.firebaseapp.com",
    projectId: "card-game-dashboard",
    storageBucket: "card-game-dashboard.firebasestorage.app",
    messagingSenderId: "165351945339",
    appId: "1:165351945339:web:b1725b0d9272d67369dede",
    measurementId: "G-2GJ3CXDKGJ"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export for use in other modules
window.firebaseApp = firebase.app();
window.firebaseDb = firebase.firestore();

// Test Firebase connection
async function testFirebaseConnection() {
    try {
        console.log('Testing Firebase connection...');
        const db = firebase.firestore();
        const testDoc = await db.collection('test').doc('connection').get();
        console.log('✅ Firebase connection successful!');
        return true;
    } catch (error) {
        console.error('❌ Firebase connection failed:', error);
        return false;
    }
}

// Auto-test connection when page loads
document.addEventListener('DOMContentLoaded', () => {
    testFirebaseConnection();
});