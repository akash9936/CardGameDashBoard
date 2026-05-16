#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const {
    getFirestore, doc, writeBatch, collection, getDocs
} = require('firebase/firestore');

const TEAMS_SRC = path.join(__dirname, '..', 'db-dump', 'teams.json');
const MATCHES_SRC = path.join(__dirname, '..', 'db-dump', 'matches.json');
const BACKUP_DIR = path.join(__dirname, '..', 'db-dump', 'pre-restore');

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

function asId(v) {
    if (v === null || v === undefined) throw new Error('id null');
    return String(v);
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

async function dumpToFile(db, name, outFile) {
    const snap = await getDocs(collection(db, name));
    const docs = snap.docs.map(d => ({ id: d.id, ...serialize(d.data()) }));
    fs.writeFileSync(outFile, JSON.stringify(docs, null, 2));
    return docs.length;
}

async function writeBatched(db, target, items) {
    const BATCH = 450;
    let n = 0;
    for (let i = 0; i < items.length; i += BATCH) {
        const slice = items.slice(i, i + BATCH);
        const b = writeBatch(db);
        for (const it of slice) b.set(doc(db, target, it._id), it.data);
        await b.commit();
        n += slice.length;
        console.log(`  ${target}: ${n}/${items.length}`);
    }
}

async function main() {
    loadEnv();
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey) { console.error('FIREBASE_API_KEY missing'); process.exit(1); }

    const app = initializeApp({
        apiKey,
        authDomain: 'card-game-dashboard.firebaseapp.com',
        projectId: 'card-game-dashboard',
        storageBucket: 'card-game-dashboard.firebasestorage.app',
        messagingSenderId: '165351945339',
        appId: '1:165351945339:web:b1725b0d9272d67369dede',
    });
    const db = getFirestore(app);

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('Backing up current live state...');
    const tBackup = await dumpToFile(db, 'teams', path.join(BACKUP_DIR, 'teams.json'));
    const mBackup = await dumpToFile(db, 'matches', path.join(BACKUP_DIR, 'matches.json'));
    console.log(`  backed up: ${tBackup} teams, ${mBackup} matches → db-dump/pre-restore/`);

    const rawTeams = JSON.parse(fs.readFileSync(TEAMS_SRC, 'utf8'));
    const rawMatches = JSON.parse(fs.readFileSync(MATCHES_SRC, 'utf8'));

    const teams = rawTeams.map(t => {
        const { id, ...rest } = t;
        return { _id: asId(id), data: rest };
    });
    const matches = rawMatches.map(m => {
        const { id, ...rest } = m;
        return { _id: asId(id), data: rest };
    });

    console.log(`Restoring ${teams.length} teams and ${matches.length} matches (overwrite-by-id, extras in live preserved)...`);
    await writeBatched(db, 'teams', teams);
    await writeBatched(db, 'matches', matches);

    const teamsLive = (await getDocs(collection(db, 'teams'))).size;
    const matchesLive = (await getDocs(collection(db, 'matches'))).size;
    console.log(`Done. Live counts now: teams=${teamsLive}, matches=${matchesLive}`);
}

main().catch(e => { console.error(e); process.exit(1); });
