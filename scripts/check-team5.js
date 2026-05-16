#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
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

    for (const target of ['teams', 'teams_v2']) {
        console.log(`\n=== ${target} ===`);
        const snap = await getDocs(collection(db, target));
        console.log(`total docs: ${snap.size}`);
        for (const d of snap.docs) {
            console.log(`  id=${d.id} | name=${d.data().name}`);
        }
        const d5 = await getDoc(doc(db, target, '5'));
        console.log(`doc('5') exists:`, d5.exists(), d5.exists() ? JSON.stringify(d5.data()) : '');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
