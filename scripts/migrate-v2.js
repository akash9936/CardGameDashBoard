#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const {
    getFirestore, doc, writeBatch, collection, getDocs
} = require('firebase/firestore');

const SCHEMA_VERSION = 2;
const TEAMS_SRC = path.join(__dirname, '..', 'db-dump', 'teams.json');
const MATCHES_SRC = path.join(__dirname, '..', 'db-dump', 'matches.json');
const TEAMS_DST = 'teams_v2';
const MATCHES_DST = 'matches_v2';

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

function asId(v) {
    if (v === null || v === undefined) throw new Error('id is null/undefined');
    return String(v);
}

function transformTeam(raw) {
    return {
        name: String(raw.name || '').trim(),
        members: Array.isArray(raw.members) ? raw.members : [],
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
    };
}

function transformRound(r) {
    return {
        roundNumber: Number(r.roundNumber),
        team1: {
            promise: Number(r.team1.promise),
            actual: Number(r.team1.actual),
            score: Number(r.team1.score),
        },
        team2: {
            promise: Number(r.team2.promise),
            actual: Number(r.team2.actual),
            score: Number(r.team2.score),
        },
    };
}

function transformMatch(raw) {
    const rounds = Array.isArray(raw.rounds)
        ? raw.rounds.map(transformRound).sort((a, b) => a.roundNumber - b.roundNumber)
        : [];

    const finalScore = raw.finalScore && typeof raw.finalScore === 'object'
        ? { team1: Number(raw.finalScore.team1 || 0), team2: Number(raw.finalScore.team2 || 0) }
        : { team1: 0, team2: 0 };

    const roundStats = raw.roundStats && typeof raw.roundStats === 'object'
        ? {
            team1: {
                won: Number(raw.roundStats.team1?.won || 0),
                lost: Number(raw.roundStats.team1?.lost || 0),
            },
            team2: {
                won: Number(raw.roundStats.team2?.won || 0),
                lost: Number(raw.roundStats.team2?.lost || 0),
            },
          }
        : { team1: { won: 0, lost: 0 }, team2: { won: 0, lost: 0 } };

    const out = {
        team1Id: asId(raw.team1Id),
        team2Id: asId(raw.team2Id),
        status: raw.status,
        currentRound: Number(raw.currentRound || rounds.length),
        rounds,
        finalScore,
        roundStats,
        createdAt: raw.date || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
    };

    if (raw.winnerId !== undefined && raw.winnerId !== null) {
        out.winnerId = asId(raw.winnerId);
    }
    if (raw.status === 'completed' || raw.status === 'cancelled') {
        out.completedAt = raw.completedAt || raw.date || new Date().toISOString();
    }
    if (raw.cancellationReason) {
        out.cancellationReason = String(raw.cancellationReason);
    }

    return out;
}

function validate(teams, matches) {
    const errors = [];
    const teamIds = new Set(teams.map(t => t._id));
    const seenTeamNames = new Map();

    for (const t of teams) {
        if (!t.data.name) errors.push(`team ${t._id}: empty name`);
        const lower = t.data.name.toLowerCase();
        if (seenTeamNames.has(lower)) {
            errors.push(`team ${t._id}: duplicate name "${t.data.name}" (also ${seenTeamNames.get(lower)})`);
        } else {
            seenTeamNames.set(lower, t._id);
        }
    }

    for (const m of matches) {
        const d = m.data;
        if (d.team1Id === d.team2Id) errors.push(`match ${m._id}: self-play`);
        if (!teamIds.has(d.team1Id)) errors.push(`match ${m._id}: team1 ${d.team1Id} missing`);
        if (!teamIds.has(d.team2Id)) errors.push(`match ${m._id}: team2 ${d.team2Id} missing`);
        for (const r of d.rounds) {
            if (r.team1.actual + r.team2.actual !== 13) {
                errors.push(`match ${m._id} round ${r.roundNumber}: actuals sum to ${r.team1.actual + r.team2.actual}, not 13`);
            }
        }
    }
    return errors;
}

async function commitInBatches(db, target, items) {
    const BATCH_LIMIT = 450;
    let written = 0;
    for (let i = 0; i < items.length; i += BATCH_LIMIT) {
        const slice = items.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const { _id, data } of slice) {
            batch.set(doc(db, target, _id), data);
        }
        await batch.commit();
        written += slice.length;
        console.log(`  ${target}: committed ${written}/${items.length}`);
    }
}

async function checkDestEmpty(db, target) {
    const snap = await getDocs(collection(db, target));
    return snap.empty;
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    loadEnv();

    const rawTeams = JSON.parse(fs.readFileSync(TEAMS_SRC, 'utf8'));
    const rawMatches = JSON.parse(fs.readFileSync(MATCHES_SRC, 'utf8'));

    const teams = rawTeams.map(t => ({ _id: asId(t.id), data: transformTeam(t) }));
    const matches = rawMatches.map(m => ({ _id: asId(m.id), data: transformMatch(m) }));

    const errors = validate(teams, matches);
    if (errors.length) {
        console.error('Validation errors:');
        for (const e of errors) console.error('  -', e);
        if (!process.argv.includes('--force')) {
            console.error('\nAborting. Re-run with --force to write anyway.');
            process.exit(1);
        }
        console.error('\n--force given, continuing.');
    } else {
        console.log('Validation: OK');
    }

    console.log(`Teams: ${teams.length}, Matches: ${matches.length}`);

    if (dryRun) {
        const outDir = path.join(__dirname, '..', 'db-dump', 'v2');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
            path.join(outDir, 'teams_v2.json'),
            JSON.stringify(teams.map(t => ({ id: t._id, ...t.data })), null, 2)
        );
        fs.writeFileSync(
            path.join(outDir, 'matches_v2.json'),
            JSON.stringify(matches.map(m => ({ id: m._id, ...m.data })), null, 2)
        );
        console.log(`Dry-run written to db-dump/v2/. No Firestore writes.`);
        return;
    }

    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey || apiKey === 'your_firebase_api_key_here') {
        console.error('FIREBASE_API_KEY missing in .env');
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

    if (!process.argv.includes('--overwrite')) {
        for (const target of [TEAMS_DST, MATCHES_DST]) {
            if (!(await checkDestEmpty(db, target))) {
                console.error(`${target} is not empty. Re-run with --overwrite to proceed.`);
                process.exit(1);
            }
        }
    }

    console.log(`Writing to ${TEAMS_DST} and ${MATCHES_DST}...`);
    await commitInBatches(db, TEAMS_DST, teams);
    await commitInBatches(db, MATCHES_DST, matches);
    console.log('Done.');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
