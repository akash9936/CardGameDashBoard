const GhostService = require('../js/services/ghostService.js');
const Cards = require('../js/utils/cards.js');

// A realistic 13-card hand in photo order (left → right as fanned for the
// camera). Deliberately unsorted — photo order is whatever the deal produced.
const PHOTO_HAND = [
    '7S', 'QH', '2C', 'AS', '9H', 'JD', 'KC', '4H', '8D', 'AH', '3C', 'TS', '5D',
];

// ─── Hand-written Firestore mock ───────────────────────────────────────────
//
// No mocking library — a plain in-memory store behind the compat-SDK surface
// the service actually uses: collection/doc/get/set/update/delete, batch(),
// runTransaction(), where().get(), onSnapshot(). Documents are addressed by
// their full slash path, so "were these two writes the same document?" is a
// string comparison in the test rather than an article of faith.

function makeDb() {
    const store = new Map();       // path → data object
    const writes = [];             // ordered log: {op, path, data, options}
    const listeners = [];          // {path|query, callback, errorCallback}
    let failNextCommit = null;     // inject a batch failure

    function snapshotFor(path) {
        const data = store.get(path);
        return {
            id: path.split('/').pop(),
            ref: makeDocRef(path),
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
        };
    }

    function makeDocRef(path) {
        return {
            path,
            async get() { return snapshotFor(path); },
            async set(data, options) {
                writes.push({ op: 'set', path, data, options });
                if (options && options.merge) {
                    store.set(path, { ...(store.get(path) || {}), ...data });
                } else {
                    store.set(path, { ...data });
                }
            },
            async update(data) {
                writes.push({ op: 'update', path, data });
                if (!store.has(path)) throw new Error('No document to update.');
                store.set(path, { ...store.get(path), ...data });
            },
            async delete() {
                writes.push({ op: 'delete', path });
                store.delete(path);
            },
            collection(name) { return makeCollectionRef(`${path}/${name}`); },
            onSnapshot(cb, errCb) {
                const entry = { path, cb, errCb };
                listeners.push(entry);
                cb(snapshotFor(path));
                return () => { entry.unsubscribed = true; };
            },
        };
    }

    function docsUnder(collectionPath) {
        const out = [];
        for (const path of store.keys()) {
            const rest = path.startsWith(`${collectionPath}/`)
                ? path.slice(collectionPath.length + 1)
                : null;
            if (rest !== null && rest.indexOf('/') === -1) out.push(snapshotFor(path));
        }
        return out;
    }

    function makeQuery(collectionPath, filters) {
        return {
            path: collectionPath,
            filters,
            where(field, op, value) {
                return makeQuery(collectionPath, filters.concat([{ field, op, value }]));
            },
            async get() {
                const docs = docsUnder(collectionPath).filter((d) => filters.every(
                    (f) => (d.data() || {})[f.field] === f.value
                ));
                return { docs, empty: docs.length === 0, size: docs.length };
            },
            onSnapshot(cb, errCb) {
                const entry = { query: { collectionPath, filters }, cb, errCb };
                listeners.push(entry);
                const docs = docsUnder(collectionPath).filter((d) => filters.every(
                    (f) => (d.data() || {})[f.field] === f.value
                ));
                cb({ docs, empty: docs.length === 0, size: docs.length });
                return () => { entry.unsubscribed = true; };
            },
        };
    }

    function makeCollectionRef(collectionPath) {
        const q = makeQuery(collectionPath, []);
        return { ...q, doc: (id) => makeDocRef(`${collectionPath}/${id}`) };
    }

    const db = {
        _store: store,
        _writes: writes,
        _listeners: listeners,
        _seed(path, data) { store.set(path, { ...data }); },
        _failNextCommit(message) { failNextCommit = message; },
        _writesTo(path) { return writes.filter((w) => w.path === path); },
        _batches: [],

        collection(name) { return makeCollectionRef(name); },

        batch() {
            const ops = [];
            db._batches.push(ops);
            return {
                ops,
                delete(ref) { ops.push({ op: 'delete', path: ref.path }); },
                set(ref, data) { ops.push({ op: 'set', path: ref.path, data }); },
                async commit() {
                    if (failNextCommit) {
                        const msg = failNextCommit;
                        failNextCommit = null;
                        throw new Error(msg);
                    }
                    for (const o of ops) {
                        writes.push(o);
                        if (o.op === 'delete') store.delete(o.path);
                        else store.set(o.path, { ...o.data });
                    }
                },
            };
        },

        async runTransaction(fn) {
            const tx = {
                async get(ref) { return snapshotFor(ref.path); },
                set(ref, data, options) {
                    writes.push({ op: 'set', path: ref.path, data, options, tx: true });
                    if (options && options.merge) {
                        store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
                    } else {
                        store.set(ref.path, { ...data });
                    }
                },
                update(ref, data) {
                    writes.push({ op: 'update', path: ref.path, data, tx: true });
                    store.set(ref.path, { ...(store.get(ref.path) || {}), ...data });
                },
                delete(ref) {
                    writes.push({ op: 'delete', path: ref.path, tx: true });
                    store.delete(ref.path);
                },
            };
            return fn(tx);
        },
    };

    return db;
}

// `firebase.firestore.FieldValue.serverTimestamp()` is a sentinel in the real
// SDK; here it is a recognisable marker so tests can assert it was used.
const SERVER_TS = '__serverTimestamp__';
global.firebase = {
    firestore: {
        FieldValue: { serverTimestamp: () => SERVER_TS },
    },
};

// The service needs crypto.getRandomValues for access codes. Node 18+ has it
// globally; supply a deterministic stub if it is missing.
if (typeof global.crypto === 'undefined' || typeof global.crypto.getRandomValues !== 'function') {
    global.crypto = {
        getRandomValues(arr) {
            for (let i = 0; i < arr.length; i++) arr[i] = (i * 7 + 3) % 256;
            return arr;
        },
    };
}

function makeService() {
    const db = makeDb();
    return { db, service: new GhostService({ db }) };
}

const MATCH = 'm1';
const SEAT = 'teamA_0';
const ROUND_PATH = `matches/${MATCH}/ghostRounds/0_${SEAT}`;
const PHOTO_PATH = `matches/${MATCH}/ghostPhotos/0_${SEAT}`;

// ─── Module shape ──────────────────────────────────────────────────────────

describe('GhostService module shape', () => {
    test('exports a constructor with a pure logic object attached', () => {
        expect(typeof GhostService).toBe('function');
        expect(typeof GhostService.logic).toBe('object');
        expect(typeof GhostService.logic.seatKey).toBe('function');
    });

    test('constructor requires a firebaseService with a .db handle', () => {
        expect(() => new GhostService(null)).toThrow(/requires a firebaseService/);
        expect(() => new GhostService({})).toThrow(/requires a firebaseService/);
    });

    test('uses firebaseService.db directly rather than the wrapper methods', () => {
        const { db, service } = makeService();
        expect(service.db).toBe(db);
    });

    test('card delivery only — no promise/blind surface exists on the API', () => {
        const names = Object.getOwnPropertyNames(GhostService.prototype)
            .concat(Object.keys(GhostService.logic));
        for (const name of names) {
            expect(name.toLowerCase()).not.toContain('blind');
            expect(name.toLowerCase()).not.toContain('promise');
        }
    });
});

// ─── Pure logic: keys ──────────────────────────────────────────────────────

describe('logic.seatKey / logic.roundDocId', () => {
    test('seatKey joins teamId and memberIndex', () => {
        expect(GhostService.logic.seatKey('teamA', 0)).toBe('teamA_0');
        expect(GhostService.logic.seatKey('teamB', 1)).toBe('teamB_1');
    });

    test('roundDocId prefixes the round index', () => {
        expect(GhostService.logic.roundDocId(0, 'teamA_0')).toBe('0_teamA_0');
        expect(GhostService.logic.roundDocId(12, 'teamB_1')).toBe('12_teamB_1');
    });

    test('instance methods mirror the pure helpers', () => {
        const { service } = makeService();
        expect(service.seatKey('teamA', 1)).toBe(GhostService.logic.seatKey('teamA', 1));
        expect(service.roundDocId(3, 'teamA_1')).toBe(GhostService.logic.roundDocId(3, 'teamA_1'));
    });
});

// ─── Pure logic: seat selection gate ───────────────────────────────────────

describe('logic.validateSeatSelection', () => {
    const seat = (t, i) => ({ teamId: t, memberIndex: i, memberName: `P${i}` });

    test('0 seats is invalid', () => {
        const r = GhostService.logic.validateSeatSelection([]);
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/at least 1/i);
    });

    test('1, 2 and 3 seats are valid', () => {
        expect(GhostService.logic.validateSeatSelection([seat('a', 0)]).ok).toBe(true);
        expect(GhostService.logic.validateSeatSelection([seat('a', 0), seat('a', 1)]).ok).toBe(true);
        expect(GhostService.logic.validateSeatSelection(
            [seat('a', 0), seat('a', 1), seat('b', 0)]
        ).ok).toBe(true);
    });

    test('4 seats is invalid — no physical player would be left', () => {
        const r = GhostService.logic.validateSeatSelection(
            [seat('a', 0), seat('a', 1), seat('b', 0), seat('b', 1)]
        );
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/at least one player must stay physical/i);
    });

    test('duplicate seat keys are invalid', () => {
        const r = GhostService.logic.validateSeatSelection([seat('a', 0), seat('a', 0)]);
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/Duplicate ghost seat: a_0/);
    });

    test('memberIndex 0 is not mistaken for missing', () => {
        expect(GhostService.logic.validateSeatSelection([seat('a', 0)]).errors).toEqual([]);
    });

    test('non-array and malformed entries are rejected', () => {
        expect(GhostService.logic.validateSeatSelection(null).ok).toBe(false);
        expect(GhostService.logic.validateSeatSelection('a_0').ok).toBe(false);
        expect(GhostService.logic.validateSeatSelection([{ teamId: 'a' }]).ok).toBe(false);
        expect(GhostService.logic.validateSeatSelection([null]).ok).toBe(false);
    });
});

// ─── Pure logic: canPlay ───────────────────────────────────────────────────

describe('logic.canPlay', () => {
    test('a held, unplayed card can be played', () => {
        expect(GhostService.logic.canPlay('AS', PHOTO_HAND, [])).toBe(true);
        expect(GhostService.logic.canPlay('5D', PHOTO_HAND, ['AS'])).toBe(true);
    });

    test('an already-played card cannot be played again', () => {
        expect(GhostService.logic.canPlay('AS', PHOTO_HAND, ['AS'])).toBe(false);
    });

    test('a never-held card cannot be played', () => {
        expect(GhostService.logic.canPlay('KS', PHOTO_HAND, [])).toBe(false);
    });

    test('junk codes are rejected', () => {
        expect(GhostService.logic.canPlay('ZZ', PHOTO_HAND, [])).toBe(false);
        expect(GhostService.logic.canPlay('as', PHOTO_HAND, [])).toBe(false);
        expect(GhostService.logic.canPlay(null, PHOTO_HAND, [])).toBe(false);
    });

    test('nothing is playable before the hand is confirmed', () => {
        expect(GhostService.logic.canPlay('AS', null, [])).toBe(false);
    });
});

// ─── Pure logic: chunk (500-write batch boundary) ──────────────────────────

describe('logic.chunk', () => {
    const items = (n) => Array.from({ length: n }, (_, i) => i);

    test('empty and non-array input yields no chunks', () => {
        expect(GhostService.logic.chunk([])).toEqual([]);
        expect(GhostService.logic.chunk(null)).toEqual([]);
        expect(GhostService.logic.chunk(undefined)).toEqual([]);
    });

    test('exactly 500 items is a single full batch — no trailing empty chunk', () => {
        const c = GhostService.logic.chunk(items(500));
        expect(c).toHaveLength(1);
        expect(c[0]).toHaveLength(500);
    });

    test('501 items splits 500 + 1', () => {
        const c = GhostService.logic.chunk(items(501));
        expect(c.map((g) => g.length)).toEqual([500, 1]);
    });

    test('1001 items splits 500 + 500 + 1', () => {
        const c = GhostService.logic.chunk(items(1001));
        expect(c.map((g) => g.length)).toEqual([500, 500, 1]);
    });

    test('no chunk ever exceeds the Firestore batch limit', () => {
        for (const n of [1, 499, 500, 501, 999, 1000, 1001, 2500]) {
            for (const group of GhostService.logic.chunk(items(n))) {
                expect(group.length).toBeLessThanOrEqual(500);
            }
        }
    });

    test('chunks concatenate back to the original in order', () => {
        const source = items(1001);
        expect([].concat(...GhostService.logic.chunk(source))).toEqual(source);
    });

    test('an explicit size is honoured', () => {
        expect(GhostService.logic.chunk(items(5), 2).map((g) => g.length)).toEqual([2, 2, 1]);
    });
});

// ─── Pure logic: sweep selection ───────────────────────────────────────────

describe('logic.matchesNeedingSweep', () => {
    const seats = { teamA_0: { teamId: 'teamA', memberIndex: 0, active: false } };

    const ALL = [
        { id: 'completed-ghost', status: 'completed', ghostSeats: seats },
        { id: 'cancelled-ghost', status: 'cancelled', ghostSeats: seats },
        { id: 'in-progress-ghost', status: 'in_progress', ghostSeats: seats },
        { id: 'pending-ghost', status: 'pending', ghostSeats: seats },
        { id: 'completed-no-ghost', status: 'completed' },
        { id: 'cancelled-no-ghost', status: 'cancelled', ghostSeats: {} },
        { id: 'in-progress-no-ghost', status: 'in_progress' },
    ];

    test('selects only finished matches that carry ghost seats', () => {
        expect(GhostService.logic.matchesNeedingSweep(ALL).map((m) => m.id))
            .toEqual(['completed-ghost', 'cancelled-ghost']);
    });

    test('an in_progress match WITH ghostSeats is skipped', () => {
        const ids = GhostService.logic.matchesNeedingSweep(ALL).map((m) => m.id);
        expect(ids).not.toContain('in-progress-ghost');
        expect(ids).not.toContain('pending-ghost');
    });

    test('a completed match WITHOUT ghostSeats is skipped', () => {
        const ids = GhostService.logic.matchesNeedingSweep(ALL).map((m) => m.id);
        expect(ids).not.toContain('completed-no-ghost');
        expect(ids).not.toContain('cancelled-no-ghost');
    });

    test('non-array and junk entries are tolerated', () => {
        expect(GhostService.logic.matchesNeedingSweep(null)).toEqual([]);
        expect(GhostService.logic.matchesNeedingSweep([null, 'x', 7])).toEqual([]);
    });

    test('an all-physical league sweeps nothing', () => {
        const physical = [
            { id: 'a', status: 'completed' },
            { id: 'b', status: 'cancelled' },
            { id: 'c', status: 'in_progress' },
        ];
        expect(GhostService.logic.matchesNeedingSweep(physical)).toEqual([]);
    });
});

// ─── Pure logic: photo size ────────────────────────────────────────────────

describe('logic.normaliseCapturedRequest', () => {
    const f = GhostService.logic.normaliseCapturedRequest;

    test('passes a real request number through', () => {
        expect(f(1)).toBe(1);
        expect(f(2)).toBe(2);
        expect(f(17)).toBe(17);
    });

    test('never yields a non-number — an absent field is the one unsafe shape', () => {
        for (const junk of [undefined, null, NaN, 'x', {}, [], -1, 0, false]) {
            const out = f(junk);
            expect(Number.isFinite(out)).toBe(true);
            expect(out).toBeGreaterThanOrEqual(1);
        }
    });

    test('truncates rather than rounding', () => {
        expect(f(3.9)).toBe(3);
        expect(f('4')).toBe(4);
    });
});

describe('logic.isPhotoWithinLimit', () => {
    test('accepts a photo at exactly the limit', () => {
        expect(GhostService.logic.isPhotoWithinLimit('x'.repeat(700000))).toBe(true);
    });

    test('rejects one character over, empty, and non-strings', () => {
        expect(GhostService.logic.isPhotoWithinLimit('x'.repeat(700001))).toBe(false);
        expect(GhostService.logic.isPhotoWithinLimit('')).toBe(false);
        expect(GhostService.logic.isPhotoWithinLimit(null)).toBe(false);
    });
});

// ─── Seats ─────────────────────────────────────────────────────────────────

describe('createGhostSeats', () => {
    test('writes the ghostSeats map keyed by seat key, with codes', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, { status: 'in_progress' });

        const written = await service.createGhostSeats(MATCH, [
            { teamId: 'teamA', memberIndex: 0, memberName: 'Priya' },
            { teamId: 'teamB', memberIndex: 1, memberName: 'Rahul' },
        ]);

        expect(Object.keys(written)).toEqual(['teamA_0', 'teamB_1']);
        expect(written.teamA_0.memberName).toBe('Priya');
        expect(written.teamA_0.active).toBe(true);
        expect(written.teamA_0.accessCode).toHaveLength(Cards.CODE_LENGTH);
        for (const ch of written.teamA_0.accessCode) {
            expect(Cards.CODE_CHARSET).toContain(ch);
        }
        expect(db._store.get(`matches/${MATCH}`).ghostSeats).toEqual(written);
    });

    test('stores no score-bearing field on a seat', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, {});
        const written = await service.createGhostSeats(MATCH, [
            { teamId: 'teamA', memberIndex: 0, memberName: 'Priya' },
        ]);
        expect(Object.keys(written.teamA_0).sort())
            .toEqual(['accessCode', 'active', 'memberIndex', 'memberName', 'teamId']);
    });

    test('rejects an invalid selection before touching Firestore', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, {});
        await expect(service.createGhostSeats(MATCH, [])).rejects.toThrow(/at least 1/i);
        await expect(service.createGhostSeats(MATCH, [
            { teamId: 'a', memberIndex: 0 }, { teamId: 'a', memberIndex: 1 },
            { teamId: 'b', memberIndex: 0 }, { teamId: 'b', memberIndex: 1 },
        ])).rejects.toThrow(/physical/i);
        expect(db._writes).toHaveLength(0);
    });

    test('surfaces a write failure as a meaningful Error', async () => {
        const { service } = makeService();   // match doc not seeded → update throws
        await expect(service.createGhostSeats(MATCH, [
            { teamId: 'teamA', memberIndex: 0, memberName: 'Priya' },
        ])).rejects.toThrow(/Failed to create ghost seats/);
    });
});

describe('getGhostSeat / deactivateSeats', () => {
    test('getGhostSeat returns the seat entry', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, {
            ghostSeats: { [SEAT]: { teamId: 'teamA', memberIndex: 0, accessCode: 'ABC234', active: true } },
        });
        const seat = await service.getGhostSeat(MATCH, SEAT);
        expect(seat.accessCode).toBe('ABC234');
    });

    test('getGhostSeat returns null for a missing match or seat', async () => {
        const { db, service } = makeService();
        expect(await service.getGhostSeat('nope', SEAT)).toBeNull();
        db._seed(`matches/${MATCH}`, { ghostSeats: {} });
        expect(await service.getGhostSeat(MATCH, SEAT)).toBeNull();
    });

    test('deactivateSeats flips every seat to active:false, preserving the rest', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, {
            ghostSeats: {
                teamA_0: { teamId: 'teamA', memberIndex: 0, memberName: 'Priya', accessCode: 'ABC234', active: true },
                teamB_1: { teamId: 'teamB', memberIndex: 1, memberName: 'Rahul', accessCode: 'DEF567', active: true },
            },
        });
        expect(await service.deactivateSeats(MATCH)).toBe(2);
        const seats = db._store.get(`matches/${MATCH}`).ghostSeats;
        expect(seats.teamA_0.active).toBe(false);
        expect(seats.teamB_1.active).toBe(false);
        expect(seats.teamA_0.accessCode).toBe('ABC234');
        expect(seats.teamA_0.memberName).toBe('Priya');
    });

    test('deactivateSeats is a no-op for a match with no ghost seats', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, { status: 'completed' });
        expect(await service.deactivateSeats(MATCH)).toBe(0);
        expect(db._writes).toHaveLength(0);
    });
});

// ─── Capture ───────────────────────────────────────────────────────────────

describe('requestCapture', () => {
    test('creates the round doc with the §3 shape when it is missing', async () => {
        const { db, service } = makeService();
        expect(await service.requestCapture(MATCH, 0, SEAT)).toBe(1);

        const doc = db._store.get(ROUND_PATH);
        expect(doc).toEqual({
            captureRequest: 1,
            capturedAt: null,
            capturedBy: '',
            cards: null,
            confirmedAt: null,
            playedCards: [],
            roundIndex: 0,
            seatKey: SEAT,
        });
    });

    test('stores roundIndex and seatKey as fields (no doc-id prefix queries)', async () => {
        const { db, service } = makeService();
        await service.requestCapture(MATCH, 4, SEAT);
        const doc = db._store.get(`matches/${MATCH}/ghostRounds/4_${SEAT}`);
        expect(doc.roundIndex).toBe(4);
        expect(doc.seatKey).toBe(SEAT);
    });

    test('a retake increments the counter rather than setting a flag', async () => {
        const { db, service } = makeService();
        await service.requestCapture(MATCH, 0, SEAT);
        expect(await service.requestCapture(MATCH, 0, SEAT)).toBe(2);
        expect(await service.requestCapture(MATCH, 0, SEAT)).toBe(3);
        expect(db._store.get(ROUND_PATH).captureRequest).toBe(3);
    });

    test('runs inside a transaction', async () => {
        const { db, service } = makeService();
        const spy = jest.spyOn(db, 'runTransaction');
        await service.requestCapture(MATCH, 0, SEAT);
        expect(spy).toHaveBeenCalled();
    });

    test('a transaction failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db.runTransaction = async () => { throw new Error('offline'); };
        await expect(service.requestCapture(MATCH, 0, SEAT))
            .rejects.toThrow(/Failed to request capture: offline/);
    });
});

describe('writePhoto — photo doc and round doc are separate documents', () => {
    const DATA_URL = 'data:image/jpeg;base64,AAAA';

    test('the photo lands in ghostPhotos and the markers in ghostRounds', async () => {
        const { db, service } = makeService();
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil');

        const photoWrites = db._writesTo(PHOTO_PATH);
        const roundWrites = db._writesTo(ROUND_PATH);

        // Verifiably different documents, in different subcollections.
        expect(PHOTO_PATH).not.toBe(ROUND_PATH);
        expect(photoWrites).toHaveLength(1);
        expect(roundWrites).toHaveLength(1);
        expect(photoWrites[0].path).toContain('/ghostPhotos/');
        expect(roundWrites[0].path).toContain('/ghostRounds/');
    });

    test('the round-doc write contains no photoData', async () => {
        const { db, service } = makeService();
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil');

        const roundWrite = db._writesTo(ROUND_PATH)[0];
        expect(roundWrite.data).not.toHaveProperty('photoData');
        expect(JSON.stringify(roundWrite.data)).not.toContain('base64');
        expect(db._store.get(ROUND_PATH)).not.toHaveProperty('photoData');
        expect(db._store.get(PHOTO_PATH).photoData).toBe(DATA_URL);
    });

    test('writes capturedAt/capturedBy on the round doc, merging', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 2, playedCards: [], cards: null });
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 2);

        const round = db._store.get(ROUND_PATH);
        expect(round.capturedAt).toBe(SERVER_TS);
        expect(round.capturedBy).toBe('Anil');
        expect(round.captureRequest).toBe(2);            // merge, not overwrite
        expect(db._writesTo(ROUND_PATH)[0].options).toEqual({ merge: true });
    });

    // ── BLOCKER 1: capturedRequest makes a retake observable ──

    test('persists capturedRequest — the request number the photo answered', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 3, playedCards: [], cards: null });
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 3);
        expect(db._store.get(ROUND_PATH).capturedRequest).toBe(3);
    });

    test('capturedRequest is the value the CALLER acted on, not a re-read', async () => {
        // The ghost retook while the frame was still encoding: the doc now says
        // 4, but this frame answers 2. Writing 4 would hide the outstanding
        // retake from the station.
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 4, playedCards: [], cards: null });
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 2);

        const round = db._store.get(ROUND_PATH);
        expect(round.capturedRequest).toBe(2);
        expect(round.captureRequest).toBe(4);
        expect(round.capturedRequest).toBeLessThan(round.captureRequest);
    });

    test('capturedRequest is NEVER absent, even when the caller omits it', async () => {
        // A missing field is the only shape in which a retake is invisible, so
        // the write must always carry a comparable number.
        const { db, service } = makeService();
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil');
        expect(db._store.get(ROUND_PATH).capturedRequest).toBe(1);

        for (const junk of [null, undefined, 'x', NaN, 0, -3, 1.7]) {
            const fresh = makeService();
            await fresh.service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', junk);
            const value = fresh.db._store.get(ROUND_PATH).capturedRequest;
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(1);
        }
    });

    test('a fresh requestCapture → writePhoto pair leaves the two counters equal', async () => {
        const { db, service } = makeService();
        const n = await service.requestCapture(MATCH, 0, SEAT);
        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', n);
        const round = db._store.get(ROUND_PATH);
        expect(round.capturedRequest).toBe(round.captureRequest);
    });

    // ── MAJOR 4: the two writes are not atomic; failure must be visible ──

    test('a marker-write failure is retried once before surfacing', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, playedCards: [] });

        const roundPathWrites = [];
        const realCollection = db.collection.bind(db);
        let failuresLeft = 1;
        db.collection = (name) => wrapCollection(realCollection(name));
        function wrapCollection(coll) {
            return {
                ...coll,
                doc: (id) => wrapDoc(coll.doc(id)),
            };
        }
        function wrapDoc(ref) {
            return {
                ...ref,
                collection: (n) => wrapCollection(ref.collection(n)),
                async set(data, options) {
                    if (ref.path === ROUND_PATH) {
                        roundPathWrites.push(data);
                        if (failuresLeft > 0) {
                            failuresLeft -= 1;
                            throw new Error('network blip');
                        }
                    }
                    return ref.set(data, options);
                },
            };
        }

        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 1);
        // Two marker attempts; the second one landed.
        expect(roundPathWrites).toHaveLength(2);
        expect(db._store.get(ROUND_PATH).capturedRequest).toBe(1);
    });

    test('both marker attempts failing surfaces a recoverable, explicit error', async () => {
        const { db, service } = makeService();
        const realCollection = db.collection.bind(db);
        db.collection = (name) => wrapCollection(realCollection(name));
        function wrapCollection(coll) {
            return { ...coll, doc: (id) => wrapDoc(coll.doc(id)) };
        }
        function wrapDoc(ref) {
            return {
                ...ref,
                collection: (n) => wrapCollection(ref.collection(n)),
                async set(data, options) {
                    if (ref.path === ROUND_PATH) throw new Error('offline');
                    return ref.set(data, options);
                },
            };
        }

        await expect(service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 1))
            .rejects.toThrow(/the photo was stored but the round could not be marked/);
        // The documented partial state: photo present, marker absent — so the
        // ghost stays on WAITING_CAPTURE and the seat stays queued, rather than
        // the failure vanishing silently.
        expect(db._store.get(PHOTO_PATH).photoData).toBe(DATA_URL);
        expect(db._store.has(ROUND_PATH)).toBe(false);
    });

    test('retrying writePhoto after a partial write repairs it', async () => {
        const { db, service } = makeService();
        // Simulate the partial state directly: photo stored, no marker.
        db._seed(PHOTO_PATH, { photoData: DATA_URL, roundIndex: 0, seatKey: SEAT });
        db._seed(ROUND_PATH, { captureRequest: 1, playedCards: [], cards: null });

        await service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil', 1);
        const round = db._store.get(ROUND_PATH);
        expect(round.capturedAt).toBe(SERVER_TS);
        expect(round.capturedRequest).toBe(1);
        expect(round.captureRequest).toBe(1);            // merge, nothing clobbered
        expect(db._store.get(PHOTO_PATH).photoData).toBe(DATA_URL);
    });

    test('rejects a data URL over 700000 characters', async () => {
        const { db, service } = makeService();
        const huge = `data:image/jpeg;base64,${'A'.repeat(700001)}`;
        await expect(service.writePhoto(MATCH, 0, SEAT, huge, 'Anil'))
            .rejects.toThrow(/too large to store/);
        expect(db._writes).toHaveLength(0);
    });

    test('accepts a data URL of exactly 700000 characters', async () => {
        const { db, service } = makeService();
        await service.writePhoto(MATCH, 0, SEAT, 'A'.repeat(700000), 'Anil');
        expect(db._store.get(PHOTO_PATH).photoData).toHaveLength(700000);
    });

    test('rejects empty or non-string image data', async () => {
        const { service } = makeService();
        await expect(service.writePhoto(MATCH, 0, SEAT, '', 'Anil'))
            .rejects.toThrow(/no image data/);
        await expect(service.writePhoto(MATCH, 0, SEAT, null, 'Anil'))
            .rejects.toThrow(/no image data/);
    });

    test('a write failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        const original = db.collection;
        db.collection = (name) => {
            const ref = original.call(db, name);
            return {
                ...ref,
                doc: (id) => {
                    const d = ref.doc(id);
                    return { ...d, collection: (n) => ({
                        ...d.collection(n),
                        doc: () => ({ path: 'x', set: async () => { throw new Error('offline'); } }),
                    }) };
                },
            };
        };
        await expect(service.writePhoto(MATCH, 0, SEAT, DATA_URL, 'Anil'))
            .rejects.toThrow(/Failed to save the captured hand: offline/);
    });
});

describe('getPhoto — one-shot read, never a listener', () => {
    test('returns the stored data URL', async () => {
        const { db, service } = makeService();
        db._seed(PHOTO_PATH, { photoData: 'data:image/jpeg;base64,ZZZ' });
        expect(await service.getPhoto(MATCH, 0, SEAT)).toBe('data:image/jpeg;base64,ZZZ');
    });

    test('returns null when nothing has been captured', async () => {
        const { service } = makeService();
        expect(await service.getPhoto(MATCH, 0, SEAT)).toBeNull();
    });

    test('registers no snapshot listener', async () => {
        const { db, service } = makeService();
        db._seed(PHOTO_PATH, { photoData: 'data:image/jpeg;base64,ZZZ' });
        await service.getPhoto(MATCH, 0, SEAT);
        expect(db._listeners).toHaveLength(0);
    });

    test('a read failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db.collection = () => { throw new Error('offline'); };
        await expect(service.getPhoto(MATCH, 0, SEAT))
            .rejects.toThrow(/Failed to load the hand photo: offline/);
    });
});

// ─── Hand ──────────────────────────────────────────────────────────────────

describe('confirmHand', () => {
    test('writes cards in photo order plus confirmedAt', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, playedCards: [] });
        await service.confirmHand(MATCH, 0, SEAT, PHOTO_HAND);

        const round = db._store.get(ROUND_PATH);
        expect(round.cards).toEqual(PHOTO_HAND);
        expect(round.confirmedAt).toBe(SERVER_TS);
        expect(round.captureRequest).toBe(1);            // merged, not clobbered
    });

    test('stores no score-bearing field alongside the hand', async () => {
        const { db, service } = makeService();
        await service.confirmHand(MATCH, 0, SEAT, PHOTO_HAND);
        const keys = Object.keys(db._writesTo(ROUND_PATH)[0].data);
        expect(keys.sort()).toEqual(['cards', 'confirmedAt', 'roundIndex', 'seatKey']);
    });

    test('rejects a 12-card hand', async () => {
        const { db, service } = makeService();
        await expect(service.confirmHand(MATCH, 0, SEAT, PHOTO_HAND.slice(0, 12)))
            .rejects.toThrow(/exactly 13 cards/);
        expect(db._writes).toHaveLength(0);
    });

    test('rejects a 14-card hand', async () => {
        const { service } = makeService();
        await expect(service.confirmHand(MATCH, 0, SEAT, PHOTO_HAND.concat(['KS'])))
            .rejects.toThrow(/exactly 13 cards/);
    });

    test('rejects a duplicate-containing hand', async () => {
        const { db, service } = makeService();
        const dupes = PHOTO_HAND.slice(0, 12).concat(['7S']);
        await expect(service.confirmHand(MATCH, 0, SEAT, dupes))
            .rejects.toThrow(/Duplicate card/);
        expect(db._writes).toHaveLength(0);
    });

    test('rejects a hand containing a junk code', async () => {
        const { service } = makeService();
        const junk = PHOTO_HAND.slice(0, 12).concat(['ZZ']);
        await expect(service.confirmHand(MATCH, 0, SEAT, junk))
            .rejects.toThrow(/Not a valid card code/);
    });

    test('does not mutate or alias the caller array', async () => {
        const { db, service } = makeService();
        const input = PHOTO_HAND.slice();
        await service.confirmHand(MATCH, 0, SEAT, input);
        input[0] = 'KS';
        expect(db._store.get(ROUND_PATH).cards[0]).toBe('7S');
    });

    test('a write failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db.collection = () => { throw new Error('offline'); };
        await expect(service.confirmHand(MATCH, 0, SEAT, PHOTO_HAND))
            .rejects.toThrow(/Failed to confirm hand: offline/);
    });
});

// ─── BLOCKER 2: clearHand — the executor for the reducer's clearCards ──────

describe('clearHand — the retake-after-confirm path', () => {
    test('clears cards and confirmedAt, merging (nothing else is touched)', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, {
            captureRequest: 2,
            capturedAt: SERVER_TS,
            capturedRequest: 1,
            capturedBy: 'Anil',
            cards: PHOTO_HAND.slice(),
            confirmedAt: SERVER_TS,
            playedCards: [],
            roundIndex: 0,
            seatKey: SEAT,
        });

        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(true);

        const round = db._store.get(ROUND_PATH);
        expect(round.cards).toBeNull();
        expect(round.confirmedAt).toBeNull();
        // Everything else survives: the retake is still outstanding.
        expect(round.captureRequest).toBe(2);
        expect(round.capturedRequest).toBe(1);
        expect(round.capturedBy).toBe('Anil');
        expect(round.playedCards).toEqual([]);
        expect(round.seatKey).toBe(SEAT);
    });

    test('confirmHand structurally cannot do this job — it only accepts a full 13', async () => {
        const { service } = makeService();
        for (const attempt of [null, [], PHOTO_HAND.slice(0, 12)]) {
            await expect(service.confirmHand(MATCH, 0, SEAT, attempt)).rejects.toThrow();
        }
    });

    // ── The playedCards decision: refuse, do not zero ──

    test('REFUSES while any card has been played this round', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, {
            cards: PHOTO_HAND.slice(),
            confirmedAt: SERVER_TS,
            playedCards: ['7S'],
        });

        await expect(service.clearHand(MATCH, 0, SEAT))
            .rejects.toThrow(/1 card has already been played this round/);

        // Nothing was written: cards and playedCards stay consistent, so
        // remainingHand (and every position announcement) stays correct.
        const round = db._store.get(ROUND_PATH);
        expect(round.cards).toEqual(PHOTO_HAND);
        expect(round.playedCards).toEqual(['7S']);
        expect(db._writesTo(ROUND_PATH)).toHaveLength(0);
    });

    test('the refusal message tells the ghost how to repair it', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: ['7S', 'QH', '2C'] });
        await expect(service.clearHand(MATCH, 0, SEAT))
            .rejects.toThrow(/3 cards have already been played/);
        await expect(service.clearHand(MATCH, 0, SEAT)).rejects.toThrow(/Undo last card/);
    });

    test('it never silently zeroes playedCards — the corruption it exists to avoid', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: ['7S', 'QH'] });
        await expect(service.clearHand(MATCH, 0, SEAT)).rejects.toThrow();
        expect(db._store.get(ROUND_PATH).playedCards).toEqual(['7S', 'QH']);
        // remainingHand is still computed against a hand that matches the plays.
        expect(Cards.remainingHand(
            db._store.get(ROUND_PATH).cards,
            db._store.get(ROUND_PATH).playedCards
        )).toHaveLength(11);
    });

    test('undoing every play unblocks the clear', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: ['7S'] });
        await expect(service.clearHand(MATCH, 0, SEAT)).rejects.toThrow(/already been played/);

        expect(await service.undoLastCard(MATCH, 0, SEAT)).toBe('7S');
        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(true);
        expect(db._store.get(ROUND_PATH).cards).toBeNull();
    });

    // ── Idempotence / edge cases ──

    test('is idempotent: a second clear reports "nothing to clear" rather than erroring', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: [] });
        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(true);
        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(false);
    });

    test('no round doc, or an unconfirmed hand, is a no-op', async () => {
        const { db, service } = makeService();
        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(false);
        expect(db._writesTo(ROUND_PATH)).toHaveLength(0);

        db._seed(ROUND_PATH, { captureRequest: 1, cards: null, playedCards: [] });
        expect(await service.clearHand(MATCH, 0, SEAT)).toBe(false);
    });

    test('runs inside a transaction — the played check and the write cannot race', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: [] });
        const spy = jest.spyOn(db, 'runTransaction');
        await service.clearHand(MATCH, 0, SEAT);
        expect(spy).toHaveBeenCalled();
    });

    test('a transaction failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: [] });
        db.runTransaction = async () => { throw new Error('offline'); };
        await expect(service.clearHand(MATCH, 0, SEAT))
            .rejects.toThrow(/Failed to clear the hand: offline/);
    });

    test('a cleared hand can be re-confirmed from the new photo', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, cards: PHOTO_HAND.slice(), playedCards: [] });
        await service.clearHand(MATCH, 0, SEAT);

        // Retake lands, ghost re-enters a different fan order.
        const reordered = PHOTO_HAND.slice().reverse();
        await service.confirmHand(MATCH, 0, SEAT, reordered);
        expect(db._store.get(ROUND_PATH).cards).toEqual(reordered);
    });
});

describe('CONTRACT — the reducer\'s clearCards effect has an executor', () => {
    const GhostSeatView = require('../js/components/ghostSeatView.js');

    /** Effect type → the GhostService method that executes it. */
    const EFFECT_EXECUTORS = {
        requestCapture: 'requestCapture',
        clearCards: 'clearHand',
        confirmHand: 'confirmHand',
        playCard: 'playCard',
        undoLastCard: 'undoLastCard',
        saveDisplayOrder: null,          // localStorage only — never a service call
    };

    /** Drive the reducer over every path that can emit an effect. */
    function everyEffectType() {
        const L = GhostSeatView.logic;
        const doc = {
            captureRequest: 1, capturedAt: 1000, capturedBy: 'Anil',
            capturedRequest: 1, cards: PHOTO_HAND.slice(), confirmedAt: 2000,
            playedCards: ['7S'],
        };
        const accepted = { ...L.initialState(), photoAccepted: true, acceptedSeq: 1 };
        const seen = new Set();
        // A retake needs BOTH shapes to enumerate every effect:
        //   - `doc` has playedCards, so retakeBlockedBy refuses and the
        //     reducer emits nothing (the mid-play guard).
        //   - `docUnplayed` is confirmed with nothing played, which is the
        //     only path that emits clearCards.
        // Enumerating only the first shape made this helper miss clearCards
        // entirely and contradicted the guard it was documenting.
        const docUnplayed = { ...doc, playedCards: [] };
        const actions = [
            { type: 'requestCapture' },
            { type: 'retake', doc },
            { type: 'retake', doc: docUnplayed },
            { type: 'play', card: 'QH', doc },
            { type: 'undoLastCard', doc },
            { type: 'sort', mode: 'suit', doc },
            { type: 'reorder', fromIndex: 0, toIndex: 1, doc },
        ];
        for (const a of actions) {
            for (const e of L.reduce(accepted, a).effects) seen.add(e.type);
        }
        const full = PHOTO_HAND.reduce(
            (s, card) => L.reduce(s, { type: 'toggle', card, source: 'grid' }).state,
            L.initialState()
        );
        for (const e of L.reduce(full, { type: 'confirm' }).effects) seen.add(e.type);
        return seen;
    }

    test('every effect the reducer can emit is in the executor table', () => {
        for (const type of everyEffectType()) {
            expect(Object.prototype.hasOwnProperty.call(EFFECT_EXECUTORS, type)).toBe(true);
        }
    });

    test('every service-backed effect names a method GhostService actually has', () => {
        const { service } = makeService();
        for (const [effect, method] of Object.entries(EFFECT_EXECUTORS)) {
            if (method === null) continue;
            expect(typeof service[method]).toBe(
                'function',
                `effect "${effect}" maps to a missing method "${method}"`
            );
        }
    });

    test('clearCards specifically — the BLOCKER 2 regression', () => {
        const { service } = makeService();
        // The reducer emits it on retake-after-confirm...
        expect([...everyEffectType()]).toContain('clearCards');
        // ...and a method exists that can execute it.
        expect(typeof service.clearHand).toBe('function');
        // confirmHand cannot stand in: it can never write cards: null.
        expect(service.clearHand).not.toBe(service.confirmHand);
    });

    test('end to end: reducer retake-after-confirm → clearHand → server hand gone', async () => {
        const { db, service } = makeService();
        const L = GhostSeatView.logic;

        // A confirmed hand, nothing played yet.
        db._seed(ROUND_PATH, {
            captureRequest: 1,
            capturedAt: SERVER_TS,
            capturedRequest: 1,
            cards: PHOTO_HAND.slice(),
            confirmedAt: SERVER_TS,
            playedCards: [],
            roundIndex: 0,
            seatKey: SEAT,
        });
        const doc = { ...db._store.get(ROUND_PATH) };

        // The ghost spots a typo and taps Retake.
        const { effects } = L.reduce(
            { ...L.initialState(), photoAccepted: true, acceptedSeq: 1 },
            { type: 'retake', doc }
        );
        expect(effects.map((e) => e.type)).toEqual(['requestCapture', 'clearCards']);

        // Execute them through the documented mapping.
        for (const effect of effects) {
            const method = EFFECT_EXECUTORS[effect.type];
            await service[method](MATCH, 0, SEAT);
        }

        const round = db._store.get(ROUND_PATH);
        expect(round.cards).toBeNull();               // stale hand gone
        expect(round.confirmedAt).toBeNull();
        expect(round.captureRequest).toBe(2);         // shutter re-fired
        expect(round.capturedRequest).toBe(1);        // station owes a frame
        // Nothing can be played from a cleared hand.
        expect(GhostService.logic.canPlay('7S', round.cards, round.playedCards)).toBe(false);
    });
});

// ─── Play / undo ───────────────────────────────────────────────────────────

describe('playCard', () => {
    function seedConfirmed(db, played = []) {
        db._seed(ROUND_PATH, {
            captureRequest: 1,
            cards: PHOTO_HAND.slice(),
            playedCards: played,
            roundIndex: 0,
            seatKey: SEAT,
        });
    }

    test('appends a legitimately held card, preserving play order', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);

        expect(await service.playCard(MATCH, 0, SEAT, 'AS')).toEqual(['AS']);
        expect(await service.playCard(MATCH, 0, SEAT, '2C')).toEqual(['AS', '2C']);
        expect(await service.playCard(MATCH, 0, SEAT, 'TS')).toEqual(['AS', '2C', 'TS']);
        expect(db._store.get(ROUND_PATH).playedCards).toEqual(['AS', '2C', 'TS']);
    });

    test('rejects a card that has already been played', async () => {
        const { db, service } = makeService();
        seedConfirmed(db, ['AS']);
        await expect(service.playCard(MATCH, 0, SEAT, 'AS'))
            .rejects.toThrow(/already been played/);
        expect(db._store.get(ROUND_PATH).playedCards).toEqual(['AS']);
    });

    test('rejects a card that was never held', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);
        await expect(service.playCard(MATCH, 0, SEAT, 'KS'))
            .rejects.toThrow(/not in your hand/);
        expect(db._store.get(ROUND_PATH).playedCards).toEqual([]);
    });

    test('rejects a junk card code before any read', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);
        await expect(service.playCard(MATCH, 0, SEAT, 'ZZ'))
            .rejects.toThrow(/not a valid card code/);
    });

    test('rejects when the round doc does not exist', async () => {
        const { service } = makeService();
        await expect(service.playCard(MATCH, 0, SEAT, 'AS'))
            .rejects.toThrow(/has not started yet/);
    });

    test('rejects when the hand has not been confirmed', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, cards: null, playedCards: [] });
        await expect(service.playCard(MATCH, 0, SEAT, 'AS'))
            .rejects.toThrow(/not in your hand/);
    });

    test('runs inside a transaction (compat SDK has no arrayUnion pop)', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);
        const spy = jest.spyOn(db, 'runTransaction');
        await service.playCard(MATCH, 0, SEAT, 'AS');
        expect(spy).toHaveBeenCalled();
    });

    test('a full 13-card round plays out in order', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);
        for (const card of PHOTO_HAND) {
            await service.playCard(MATCH, 0, SEAT, card);
        }
        expect(db._store.get(ROUND_PATH).playedCards).toEqual(PHOTO_HAND);
        expect(Cards.remainingHand(PHOTO_HAND, db._store.get(ROUND_PATH).playedCards)).toEqual([]);
    });

    test('a transaction failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        seedConfirmed(db);
        db.runTransaction = async () => { throw new Error('offline'); };
        await expect(service.playCard(MATCH, 0, SEAT, 'AS'))
            .rejects.toThrow(/Failed to play card: offline/);
    });
});

describe('undoLastCard', () => {
    test('pops exactly the last entry and returns it', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, {
            cards: PHOTO_HAND.slice(),
            playedCards: ['AS', '2C', 'TS'],
        });
        expect(await service.undoLastCard(MATCH, 0, SEAT)).toBe('TS');
        expect(db._store.get(ROUND_PATH).playedCards).toEqual(['AS', '2C']);
    });

    test('rejects when playedCards is empty', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: [] });
        await expect(service.undoLastCard(MATCH, 0, SEAT))
            .rejects.toThrow(/no played card to take back/);
        expect(db._writesTo(ROUND_PATH)).toHaveLength(0);
    });

    test('rejects when the round doc does not exist', async () => {
        const { service } = makeService();
        await expect(service.undoLastCard(MATCH, 0, SEAT))
            .rejects.toThrow(/has not started yet/);
    });

    test('the undone card becomes playable again', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: [] });
        await service.playCard(MATCH, 0, SEAT, 'AS');
        await expect(service.playCard(MATCH, 0, SEAT, 'AS')).rejects.toThrow(/already been played/);
        expect(await service.undoLastCard(MATCH, 0, SEAT)).toBe('AS');
        expect(await service.playCard(MATCH, 0, SEAT, 'AS')).toEqual(['AS']);
    });

    test('undo down to empty then rejects again', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: ['AS', '2C'] });
        expect(await service.undoLastCard(MATCH, 0, SEAT)).toBe('2C');
        expect(await service.undoLastCard(MATCH, 0, SEAT)).toBe('AS');
        await expect(service.undoLastCard(MATCH, 0, SEAT))
            .rejects.toThrow(/no played card to take back/);
    });

    test('a transaction failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { cards: PHOTO_HAND.slice(), playedCards: ['AS'] });
        db.runTransaction = async () => { throw new Error('offline'); };
        await expect(service.undoLastCard(MATCH, 0, SEAT))
            .rejects.toThrow(/Failed to take back the last card: offline/);
    });
});

// ─── Listeners ─────────────────────────────────────────────────────────────

describe('subscribeToGhostRound', () => {
    test('delivers the round doc and returns an unsubscribe function', () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, playedCards: ['AS'], seatKey: SEAT });

        const seen = [];
        const unsub = service.subscribeToGhostRound(MATCH, 0, SEAT, (d) => seen.push(d));

        expect(typeof unsub).toBe('function');
        expect(seen).toHaveLength(1);
        expect(seen[0].playedCards).toEqual(['AS']);
        expect(seen[0].id).toBe(`0_${SEAT}`);
        expect(db._listeners[0].path).toBe(ROUND_PATH);
        unsub();
        expect(db._listeners[0].unsubscribed).toBe(true);
    });

    test('delivers null while the round doc does not exist', () => {
        const { service } = makeService();
        const seen = [];
        service.subscribeToGhostRound(MATCH, 0, SEAT, (d) => seen.push(d));
        expect(seen).toEqual([null]);
    });

    test('the round listener never carries photo data', () => {
        const { db, service } = makeService();
        db._seed(ROUND_PATH, { captureRequest: 1, capturedAt: SERVER_TS, playedCards: [] });
        db._seed(PHOTO_PATH, { photoData: 'data:image/jpeg;base64,ZZZ' });

        let payload = null;
        service.subscribeToGhostRound(MATCH, 0, SEAT, (d) => { payload = d; });
        expect(payload).not.toHaveProperty('photoData');
        expect(JSON.stringify(payload)).not.toContain('base64');
    });
});

describe('subscribeToSeatRounds', () => {
    test('queries by the seatKey field, not a doc-id prefix', () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}/ghostRounds/0_${SEAT}`, { roundIndex: 0, seatKey: SEAT });
        db._seed(`matches/${MATCH}/ghostRounds/1_${SEAT}`, { roundIndex: 1, seatKey: SEAT });
        db._seed(`matches/${MATCH}/ghostRounds/0_teamB_1`, { roundIndex: 0, seatKey: 'teamB_1' });

        let docs = null;
        const unsub = service.subscribeToSeatRounds(MATCH, SEAT, (d) => { docs = d; });

        expect(docs.map((d) => d.id).sort()).toEqual([`0_${SEAT}`, `1_${SEAT}`]);
        expect(db._listeners[0].query.filters)
            .toEqual([{ field: 'seatKey', op: '==', value: SEAT }]);
        expect(typeof unsub).toBe('function');
        unsub();
        expect(db._listeners[0].unsubscribed).toBe(true);
    });

    test('an unknown seat yields an empty list rather than an error', () => {
        const { service } = makeService();
        let docs = null;
        service.subscribeToSeatRounds(MATCH, 'nobody_9', (d) => { docs = d; });
        expect(docs).toEqual([]);
    });
});

// ─── Cleanup ───────────────────────────────────────────────────────────────

describe('cleanupRound', () => {
    function seedRound(db, roundIndex, seatKey) {
        db._seed(`matches/${MATCH}/ghostRounds/${roundIndex}_${seatKey}`, { roundIndex, seatKey });
        db._seed(`matches/${MATCH}/ghostPhotos/${roundIndex}_${seatKey}`, {
            photoData: 'data:image/jpeg;base64,ZZZ', roundIndex, seatKey,
        });
    }

    test('deletes every seat\'s round and photo doc for that index', async () => {
        const { db, service } = makeService();
        seedRound(db, 0, 'teamA_0');
        seedRound(db, 0, 'teamB_1');

        expect(await service.cleanupRound(MATCH, 0)).toBe(4);
        expect(db._store.has(`matches/${MATCH}/ghostRounds/0_teamA_0`)).toBe(false);
        expect(db._store.has(`matches/${MATCH}/ghostPhotos/0_teamA_0`)).toBe(false);
        expect(db._store.has(`matches/${MATCH}/ghostRounds/0_teamB_1`)).toBe(false);
        expect(db._store.has(`matches/${MATCH}/ghostPhotos/0_teamB_1`)).toBe(false);
    });

    test('leaves an already-dealt next round untouched (deletes by explicit index)', async () => {
        const { db, service } = makeService();
        seedRound(db, 0, 'teamA_0');
        seedRound(db, 1, 'teamA_0');

        await service.cleanupRound(MATCH, 0);
        expect(db._store.has(`matches/${MATCH}/ghostRounds/1_teamA_0`)).toBe(true);
        expect(db._store.has(`matches/${MATCH}/ghostPhotos/1_teamA_0`)).toBe(true);
    });

    test('is a no-op for a round with no ghost docs', async () => {
        const { db, service } = makeService();
        expect(await service.cleanupRound(MATCH, 0)).toBe(0);
        expect(db._writes).toHaveLength(0);
    });

    test('a delete failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        seedRound(db, 0, 'teamA_0');
        db._failNextCommit('offline');
        await expect(service.cleanupRound(MATCH, 0))
            .rejects.toThrow(/Failed to delete ghost data for round 0: offline/);
    });

    // ── MAJOR 3: address by doc.ref / doc.id, never by a data field ──

    test('a round doc with NO seatKey field is still fully deleted, photo included', async () => {
        // The leak: rebuilding both paths from `(doc.data()||{}).seatKey` gives
        // `roundDocId(0, undefined)` → "0_undefined", so the deletes hit
        // nothing while reporting success — and a ~200 KB hand photo survives
        // the match. Cleanup is the ONLY thing that removes photos.
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}/ghostRounds/0_teamA_0`, { roundIndex: 0 });   // no seatKey
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamA_0`, {
            photoData: 'data:image/jpeg;base64,ZZZ', roundIndex: 0,
        });

        expect(await service.cleanupRound(MATCH, 0)).toBe(2);
        expect(db._store.has(`matches/${MATCH}/ghostRounds/0_teamA_0`)).toBe(false);
        expect(db._store.has(`matches/${MATCH}/ghostPhotos/0_teamA_0`)).toBe(false);
        // And no phantom "0_undefined" path was ever addressed.
        for (const w of db._writes) expect(w.path).not.toContain('undefined');
    });

    test('no photo doc survives a cleanup, whatever the round doc\'s fields say', async () => {
        const { db, service } = makeService();
        // A mixed bag: one healthy doc, one with no seatKey, one whose seatKey
        // field disagrees with its own document id (a rename, or a bad write).
        db._seed(`matches/${MATCH}/ghostRounds/0_teamA_0`, { roundIndex: 0, seatKey: 'teamA_0' });
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamA_0`, { photoData: 'x' });
        db._seed(`matches/${MATCH}/ghostRounds/0_teamB_1`, { roundIndex: 0 });
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamB_1`, { photoData: 'x' });
        db._seed(`matches/${MATCH}/ghostRounds/0_teamB_0`, { roundIndex: 0, seatKey: 'WRONG' });
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamB_0`, { photoData: 'x' });

        expect(await service.cleanupRound(MATCH, 0)).toBe(6);
        for (const p of db._store.keys()) {
            expect(p).not.toContain('/ghostRounds/');
            expect(p).not.toContain('/ghostPhotos/');
        }
    });

    test('deletes the round doc through the reference the query handed back', async () => {
        const { db, service } = makeService();
        seedRound(db, 0, 'teamA_0');
        await service.cleanupRound(MATCH, 0);
        const deleted = db._writes.filter((w) => w.op === 'delete').map((w) => w.path);
        expect(deleted).toContain(`matches/${MATCH}/ghostRounds/0_teamA_0`);
        expect(deleted).toContain(`matches/${MATCH}/ghostPhotos/0_teamA_0`);
    });

    test('still leaves the next round alone when seatKey fields are missing', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}/ghostRounds/0_teamA_0`, { roundIndex: 0 });
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamA_0`, { photoData: 'x' });
        db._seed(`matches/${MATCH}/ghostRounds/1_teamA_0`, { roundIndex: 1 });
        db._seed(`matches/${MATCH}/ghostPhotos/1_teamA_0`, { photoData: 'x' });

        await service.cleanupRound(MATCH, 0);
        expect(db._store.has(`matches/${MATCH}/ghostRounds/1_teamA_0`)).toBe(true);
        expect(db._store.has(`matches/${MATCH}/ghostPhotos/1_teamA_0`)).toBe(true);
    });
});

describe('cleanupMatch', () => {
    test('deactivates seats and deletes both subcollections', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, {
            status: 'completed',
            ghostSeats: { teamA_0: { teamId: 'teamA', memberIndex: 0, active: true } },
        });
        db._seed(`matches/${MATCH}/ghostRounds/0_teamA_0`, { roundIndex: 0, seatKey: 'teamA_0' });
        db._seed(`matches/${MATCH}/ghostRounds/1_teamA_0`, { roundIndex: 1, seatKey: 'teamA_0' });
        db._seed(`matches/${MATCH}/ghostPhotos/0_teamA_0`, { photoData: 'x' });

        expect(await service.cleanupMatch(MATCH)).toBe(3);
        expect(db._store.get(`matches/${MATCH}`).ghostSeats.teamA_0.active).toBe(false);
        for (const p of db._store.keys()) {
            expect(p).not.toContain('/ghostRounds/');
            expect(p).not.toContain('/ghostPhotos/');
        }
    });

    test('batches deletes at 500 writes per batch', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, { status: 'completed', ghostSeats: {} });
        for (let i = 0; i < 501; i++) {
            db._seed(`matches/${MATCH}/ghostRounds/${i}_teamA_0`, { roundIndex: i, seatKey: 'teamA_0' });
        }

        expect(await service.cleanupMatch(MATCH)).toBe(501);
        expect(db._batches.map((b) => b.length)).toEqual([500, 1]);
    });

    test('a batch failure surfaces as a meaningful Error', async () => {
        const { db, service } = makeService();
        db._seed(`matches/${MATCH}`, { status: 'completed' });
        db._seed(`matches/${MATCH}/ghostRounds/0_teamA_0`, { roundIndex: 0, seatKey: 'teamA_0' });
        db._failNextCommit('offline');
        await expect(service.cleanupMatch(MATCH))
            .rejects.toThrow(/Failed to delete ghost data for match m1: offline/);
    });
});

describe('sweepOrphans', () => {
    function seedMatch(db, id, status, withSeats) {
        const data = { status };
        if (withSeats) data.ghostSeats = { teamA_0: { teamId: 'teamA', memberIndex: 0, active: true } };
        db._seed(`matches/${id}`, data);
        if (withSeats) {
            db._seed(`matches/${id}/ghostRounds/0_teamA_0`, { roundIndex: 0, seatKey: 'teamA_0' });
            db._seed(`matches/${id}/ghostPhotos/0_teamA_0`, { photoData: 'x' });
        }
    }

    test('cleans only completed/cancelled matches that have ghostSeats', async () => {
        const { db, service } = makeService();
        seedMatch(db, 'done', 'completed', true);
        seedMatch(db, 'cancelled', 'cancelled', true);
        seedMatch(db, 'live', 'in_progress', true);
        seedMatch(db, 'done-physical', 'completed', false);

        const all = [
            { id: 'done', status: 'completed', ghostSeats: db._store.get('matches/done').ghostSeats },
            { id: 'cancelled', status: 'cancelled', ghostSeats: db._store.get('matches/cancelled').ghostSeats },
            { id: 'live', status: 'in_progress', ghostSeats: db._store.get('matches/live').ghostSeats },
            { id: 'done-physical', status: 'completed' },
        ];

        const result = await service.sweepOrphans(all);
        expect(result.swept).toEqual(['done', 'cancelled']);
        expect(result.failed).toEqual([]);
    });

    test('an in_progress match WITH ghostSeats keeps all of its ghost docs', async () => {
        const { db, service } = makeService();
        seedMatch(db, 'live', 'in_progress', true);
        await service.sweepOrphans([
            { id: 'live', status: 'in_progress', ghostSeats: db._store.get('matches/live').ghostSeats },
        ]);
        expect(db._store.has('matches/live/ghostRounds/0_teamA_0')).toBe(true);
        expect(db._store.has('matches/live/ghostPhotos/0_teamA_0')).toBe(true);
        expect(db._store.get('matches/live').ghostSeats.teamA_0.active).toBe(true);
        expect(db._writes).toHaveLength(0);
    });

    test('a completed match WITHOUT ghostSeats is not written to at all', async () => {
        const { db, service } = makeService();
        seedMatch(db, 'done-physical', 'completed', false);
        await service.sweepOrphans([{ id: 'done-physical', status: 'completed' }]);
        expect(db._writes).toHaveLength(0);
    });

    test('an all-physical league produces zero writes', async () => {
        const { db, service } = makeService();
        const result = await service.sweepOrphans([
            { id: 'a', status: 'completed' },
            { id: 'b', status: 'in_progress' },
            { id: 'c', status: 'pending' },
        ]);
        expect(result).toEqual({ swept: [], failed: [] });
        expect(db._writes).toHaveLength(0);
    });

    test('one failing match does not abort the sweep', async () => {
        const { db, service } = makeService();
        seedMatch(db, 'bad', 'completed', true);
        seedMatch(db, 'good', 'completed', true);
        const original = service.cleanupMatch.bind(service);
        service.cleanupMatch = async (id) => {
            if (id === 'bad') throw new Error('offline');
            return original(id);
        };

        const seats = { teamA_0: { teamId: 'teamA', memberIndex: 0, active: true } };
        const result = await service.sweepOrphans([
            { id: 'bad', status: 'completed', ghostSeats: seats },
            { id: 'good', status: 'completed', ghostSeats: seats },
        ]);
        expect(result.swept).toEqual(['good']);
        expect(result.failed).toEqual(['bad']);
    });

    test('tolerates a missing or junk match list', async () => {
        const { service } = makeService();
        expect(await service.sweepOrphans(null)).toEqual({ swept: [], failed: [] });
        expect(await service.sweepOrphans([])).toEqual({ swept: [], failed: [] });
    });
});
