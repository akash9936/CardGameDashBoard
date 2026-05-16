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

function serialize(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(serialize);
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') return value.toDate().toISOString();
        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
        return out;
    }
    return value;
}

async function dumpCollection(db, name) {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }));
}

async function main() {
    loadEnv();
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey || apiKey === 'your_firebase_api_key_here') {
        console.error('FIREBASE_API_KEY missing or unset in .env');
        process.exit(1);
    }

    const app = initializeApp({
        apiKey,
        authDomain: 'card-game-dashboard.firebaseapp.com',
        projectId: 'card-game-dashboard',
        storageBucket: 'card-game-dashboard.firebasestorage.app',
        messagingSenderId: '165351945339',
        appId: '1:165351945339:web:b1725b0d9272d67369dede',
        measurementId: 'G-2GJ3CXDKGJ'
    });
    const db = getFirestore(app);

    const outDir = path.join(__dirname, '..', 'db-dump');
    fs.mkdirSync(outDir, { recursive: true });

    for (const name of ['teams', 'matches']) {
        const docs = await dumpCollection(db, name);
        const file = path.join(outDir, `${name}.json`);
        fs.writeFileSync(file, JSON.stringify(docs, null, 2));
        console.log(`${name}: ${docs.length} docs → ${path.relative(process.cwd(), file)}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
