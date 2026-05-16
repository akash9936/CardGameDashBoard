#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

async function main() {
    loadEnv();
    const app = initializeApp({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: 'card-game-dashboard.firebaseapp.com',
        projectId: 'card-game-dashboard',
        storageBucket: 'card-game-dashboard.firebasestorage.app',
        messagingSenderId: '165351945339',
        appId: '1:165351945339:web:b1725b0d9272d67369dede',
    });
    const db = getFirestore(app);

    for (const name of ['teams', 'matches', 'teams_v2', 'matches_v2']) {
        try {
            const snap = await getDocs(collection(db, name));
            console.log(`${name}: ${snap.size} docs`);
            if (name === 'teams_v2' && snap.size) {
                console.log('  sample ids:', snap.docs.slice(0, 3).map(d => d.id).join(', '));
            }
        } catch (e) {
            console.log(`${name}: ERROR ${e.code || e.message}`);
        }
    }
}

main().catch(e => { console.error(e); process.exit(1); });
