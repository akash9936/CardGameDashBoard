const GhostStation = require('../js/components/ghostStation.js');
const GhostService = require('../js/services/ghostService.js');
const Cards = require('../js/utils/cards.js');

const L = GhostStation.logic;

// ─── Fixtures built from real service writes, not hand-authored ────────────
//
// MINOR 5: hand-authored doc shapes are how BLOCKER 1 survived review — the
// tests asserted a `capturedRequest` field that `writePhoto` never wrote. Every
// round-doc fixture below is therefore produced by driving the *actual*
// `GhostService` against an in-memory Firestore, so a field can only appear in
// a fixture if the service really writes it.

const SERVER_TS = '__serverTimestamp__';
global.firebase = {
    firestore: { FieldValue: { serverTimestamp: () => SERVER_TS } },
};

/** Minimal in-memory Firestore: just enough for set/get/merge/transactions. */
function makeDb() {
    const store = new Map();
    function docRef(path) {
        return {
            path,
            async get() {
                const d = store.get(path);
                return { id: path.split('/').pop(), exists: d !== undefined, data: () => d };
            },
            async set(data, options) {
                store.set(path, options && options.merge
                    ? { ...(store.get(path) || {}), ...data }
                    : { ...data });
            },
            async update(data) { store.set(path, { ...(store.get(path) || {}), ...data }); },
            collection(name) { return collRef(`${path}/${name}`); },
        };
    }
    function collRef(p) { return { doc: (id) => docRef(`${p}/${id}`) }; }
    return {
        _store: store,
        collection: (n) => collRef(n),
        async runTransaction(fn) {
            return fn({
                async get(ref) { return ref.get(); },
                set(ref, data, options) {
                    store.set(ref.path, options && options.merge
                        ? { ...(store.get(ref.path) || {}), ...data }
                        : { ...data });
                },
                update(ref, data) { store.set(ref.path, { ...(store.get(ref.path) || {}), ...data }); },
            });
        },
    };
}

const FIX_MATCH = 'm1';
const FIX_SEAT = 't1_0';
const FIX_PATH = `matches/${FIX_MATCH}/ghostRounds/0_${FIX_SEAT}`;

/**
 * Run a sequence of real service calls and return the resulting round doc —
 * the exact shape the station's listener would receive.
 *
 * @param {function(GhostService): Promise<void>} steps
 * @returns {Promise<Object>} The round doc as stored.
 */
async function realDoc(steps) {
    const db = makeDb();
    const service = new GhostService({ db });
    await steps(service);
    return JSON.parse(JSON.stringify(db._store.get(FIX_PATH)));
}

// A realistic 13-card hand in photo order (left → right as fanned for the
// camera). Deliberately unsorted — photo order is whatever the deal produced.
const PHOTO_HAND = [
    '7S', 'QH', '2C', 'AS', '9H', 'JD', 'KC', '4H', '8D', 'AH', '3C', 'TS', '5D',
];

// The XSS payload the spec calls for. `memberName` and `capturedBy` are pushed
// to every open station, so both are escaped at this boundary.
const XSS = '<img src=x onerror=alert(1)>';

/** A seat as it appears in `matches/{id}.ghostSeats`. */
function seat(seatKey, memberName, extra = {}) {
    return Object.assign({ seatKey, memberName, active: true }, extra);
}

/**
 * A round doc in the "photo requested, not yet delivered" state.
 *
 * Shape verified against a real `requestCapture` write by the contract test at
 * the bottom of this file.
 */
function requestedDoc(n = 1) {
    return {
        captureRequest: n,
        capturedAt: null,
        capturedBy: '',
        cards: null,
        confirmedAt: null,
        playedCards: [],
        roundIndex: 0,
        seatKey: FIX_SEAT,
    };
}

/**
 * A round doc in the "photo delivered, hand not yet entered" state.
 *
 * Shape verified against a real `requestCapture` → `writePhoto` sequence by the
 * contract test at the bottom of this file. `capturedRequest` is present
 * because `writePhoto` really writes it — that is the whole point.
 */
function capturedDoc(extra = {}) {
    return Object.assign(requestedDoc(1), {
        capturedRequest: 1,
        capturedAt: SERVER_TS,
        capturedBy: 'Dev',
    }, extra);
}

describe('escapeHtml — mirrors js/app.js:1101', () => {
    test('escapes all five characters', () => {
        expect(L.escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    test('escapes ampersand first so entities are not double-broken', () => {
        expect(L.escapeHtml('&lt;')).toBe('&amp;lt;');
    });

    test('neutralises a script payload', () => {
        const out = L.escapeHtml(XSS);
        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
        expect(out).toContain('&lt;img');
    });

    test('coerces non-strings without throwing', () => {
        expect(L.escapeHtml(42)).toBe('42');
        expect(L.escapeHtml(null)).toBe('null');
        expect(L.escapeHtml(undefined)).toBe('undefined');
    });

    test('leaves ordinary names untouched', () => {
        expect(L.escapeHtml('Rahul')).toBe('Rahul');
    });
});

describe('ordinal', () => {
    test('1st, 2nd, 3rd', () => {
        expect(L.ordinal(1)).toBe('1st');
        expect(L.ordinal(2)).toBe('2nd');
        expect(L.ordinal(3)).toBe('3rd');
    });

    test('4th through 10th take th', () => {
        expect(L.ordinal(4)).toBe('4th');
        expect(L.ordinal(5)).toBe('5th');
        expect(L.ordinal(9)).toBe('9th');
        expect(L.ordinal(10)).toBe('10th');
    });

    test('11th, 12th, 13th take th — the teens exception', () => {
        expect(L.ordinal(11)).toBe('11th');
        expect(L.ordinal(12)).toBe('12th');
        expect(L.ordinal(13)).toBe('13th');
    });

    test('covers every position in a 13-card hand', () => {
        const expected = [
            '1st', '2nd', '3rd', '4th', '5th', '6th', '7th',
            '8th', '9th', '10th', '11th', '12th', '13th',
        ];
        for (let i = 1; i <= 13; i++) expect(L.ordinal(i)).toBe(expected[i - 1]);
    });

    test('teens rule applies beyond 13 too (111th, 112th, 113th)', () => {
        expect(L.ordinal(111)).toBe('111th');
        expect(L.ordinal(112)).toBe('112th');
        expect(L.ordinal(113)).toBe('113th');
        expect(L.ordinal(21)).toBe('21st');
        expect(L.ordinal(22)).toBe('22nd');
        expect(L.ordinal(23)).toBe('23rd');
    });

    test('rejects non-positive and non-finite input', () => {
        expect(L.ordinal(0)).toBeNull();
        expect(L.ordinal(-3)).toBeNull();
        expect(L.ordinal(NaN)).toBeNull();
        expect(L.ordinal(null)).toBeNull();
        expect(L.ordinal('5')).toBeNull();
    });
});

describe('cardLabel', () => {
    test('renders T as 10, never the raw code', () => {
        expect(L.cardLabel('TS')).toBe('10♠');
        expect(L.cardLabel('TS')).not.toContain('T');
    });

    test('renders each suit symbol', () => {
        expect(L.cardLabel('QS')).toBe('Q♠');
        expect(L.cardLabel('QH')).toBe('Q♥');
        expect(L.cardLabel('QD')).toBe('Q♦');
        expect(L.cardLabel('QC')).toBe('Q♣');
    });

    test('escapes a junk code rather than dropping it', () => {
        expect(L.cardLabel('<b>')).toBe('&lt;b&gt;');
    });
});

describe('statusFor — every doc shape', () => {
    test('missing doc → waiting-deal', () => {
        expect(L.statusFor(undefined)).toBe('waiting-deal');
        expect(L.statusFor(null)).toBe('waiting-deal');
    });

    test('empty doc → captured (a doc exists, but no photo has landed)', () => {
        expect(L.statusFor({})).toBe('captured');
    });

    test('non-object doc → waiting-deal', () => {
        expect(L.statusFor('nope')).toBe('waiting-deal');
        expect(L.statusFor(7)).toBe('waiting-deal');
    });

    test('a doc with no photo yet → captured, whatever the request counter says', () => {
        expect(L.statusFor({ captureRequest: 0, playedCards: [] })).toBe('captured');
    });

    test('captureRequest but no capturedAt → captured (table owes a photo)', () => {
        expect(L.statusFor(requestedDoc(1))).toBe('captured');
    });

    test('capturedAt but no cards → entering', () => {
        expect(L.statusFor(capturedDoc())).toBe('entering');
    });

    test('capturedAt with empty cards array → entering', () => {
        expect(L.statusFor(capturedDoc({ cards: [] }))).toBe('entering');
    });

    test('retake: a newer captureRequest than the delivered photo → back to captured', () => {
        const doc = capturedDoc({ captureRequest: 2, capturedRequest: 1 });
        expect(L.statusFor(doc)).toBe('captured');
    });

    test('a doc without capturedRequest treats any photo as answering the request', () => {
        const doc = capturedDoc({ captureRequest: 3 });
        delete doc.capturedRequest;
        expect(L.statusFor(doc)).toBe('entering');
    });

    test('cards set, playedCards empty → ready', () => {
        expect(L.statusFor(capturedDoc({ cards: PHOTO_HAND }))).toBe('ready');
    });

    test('cards set, playedCards missing entirely → ready', () => {
        const doc = capturedDoc({ cards: PHOTO_HAND });
        delete doc.playedCards;
        expect(L.statusFor(doc)).toBe('ready');
    });

    test('playedCards non-empty → playing', () => {
        const doc = capturedDoc({ cards: PHOTO_HAND, playedCards: ['7S'] });
        expect(L.statusFor(doc)).toBe('playing');
    });

    test('playing wins even mid-retake — a played card means the hand is live', () => {
        const doc = capturedDoc({
            captureRequest: 5,
            capturedRequest: 1,
            cards: PHOTO_HAND,
            playedCards: ['7S', 'QH'],
        });
        expect(L.statusFor(doc)).toBe('playing');
    });

    test('only ever returns one of the five documented statuses', () => {
        const allowed = ['waiting-deal', 'captured', 'entering', 'ready', 'playing'];
        const shapes = [
            null, {}, requestedDoc(), capturedDoc(),
            capturedDoc({ cards: PHOTO_HAND }),
            capturedDoc({ cards: PHOTO_HAND, playedCards: ['7S'] }),
        ];
        for (const s of shapes) expect(allowed).toContain(L.statusFor(s));
    });
});

describe('needsCapture', () => {
    test('true until a photo has been delivered', () => {
        expect(L.needsCapture(requestedDoc())).toBe(true);
        expect(L.needsCapture(capturedDoc())).toBe(false);
        expect(L.needsCapture(capturedDoc({ cards: PHOTO_HAND }))).toBe(false);
    });

    test('true for a seat with no round doc at all — the top of every deal', () => {
        expect(L.needsCapture(undefined)).toBe(true);
        expect(L.needsCapture(null)).toBe(true);
        expect(L.needsCapture({})).toBe(true);
    });
});

describe('statusLine — wording and escaping', () => {
    test('captured → "Showing Rahul\'s hand — waiting for Rahul to capture…"', () => {
        const line = L.statusLine(seat('t1_0', 'Rahul'), requestedDoc());
        expect(line).toBe("Showing Rahul's hand — waiting for Rahul to capture…");
    });

    test('entering → "Rahul is entering their hand…"', () => {
        const line = L.statusLine(seat('t1_0', 'Rahul'), capturedDoc());
        expect(line).toBe('Rahul is entering their hand…');
    });

    test('ready → "Rahul is ready"', () => {
        const line = L.statusLine(seat('t1_0', 'Rahul'), capturedDoc({ cards: PHOTO_HAND }));
        expect(line).toBe('Rahul is ready');
    });

    test('playing reports cards left', () => {
        const doc = capturedDoc({ cards: PHOTO_HAND, playedCards: ['7S', 'QH'] });
        expect(L.statusLine(seat('t1_0', 'Rahul'), doc)).toBe('Rahul is playing — 11 cards left');
    });

    test('playing pluralises the last card correctly', () => {
        const doc = capturedDoc({ cards: PHOTO_HAND, playedCards: PHOTO_HAND.slice(0, 12) });
        expect(L.statusLine(seat('t1_0', 'Rahul'), doc)).toBe('Rahul is playing — 1 card left');
    });

    test('waiting-deal names the player too', () => {
        const line = L.statusLine(seat('t1_0', 'Rahul'), null);
        expect(line).toContain('Rahul');
        expect(line).toContain('the table is dealing');
    });

    test('a name ending in s takes a bare apostrophe', () => {
        expect(L.statusLine(seat('t1_0', 'Chris'), requestedDoc())).toContain("Chris' hand");
    });

    test('a missing name degrades to a neutral label, never "undefined"', () => {
        const line = L.statusLine({ seatKey: 't1_0' }, requestedDoc());
        expect(line).not.toContain('undefined');
        expect(line).toContain('this player');
    });

    // ── XSS ──
    test('XSS: statusLine escapes memberName in EVERY status', () => {
        const docs = [
            null,
            requestedDoc(),
            capturedDoc(),
            capturedDoc({ cards: PHOTO_HAND }),
            capturedDoc({ cards: PHOTO_HAND, playedCards: ['7S'] }),
        ];
        for (const doc of docs) {
            const line = L.statusLine(seat('t1_0', XSS), doc);
            expect(line).not.toContain('<');
            expect(line).not.toContain('onerror=alert(1)>');
            expect(line).toContain('&lt;img');
        }
    });
});

describe('capturedByLine — escaping', () => {
    test('names the handler', () => {
        expect(L.capturedByLine(capturedDoc())).toBe('Photo shown by Dev');
    });

    test('empty when nobody is recorded', () => {
        expect(L.capturedByLine(capturedDoc({ capturedBy: '' }))).toBe('');
        expect(L.capturedByLine({})).toBe('');
        expect(L.capturedByLine(null)).toBe('');
    });

    test('XSS: escapes capturedBy', () => {
        const line = L.capturedByLine(capturedDoc({ capturedBy: XSS }));
        expect(line).not.toContain('<');
        expect(line).toContain('&lt;img');
    });
});

describe('seatList', () => {
    test('sorts a ghostSeats map into seat-key order and injects seatKey', () => {
        const seats = {
            t2_1: { memberName: 'Dev' },
            t1_0: { memberName: 'Rahul' },
            t1_1: { memberName: 'Priya' },
        };
        expect(L.seatList(seats).map((s) => s.seatKey)).toEqual(['t1_0', 't1_1', 't2_1']);
        expect(L.seatList(seats)[0].memberName).toBe('Rahul');
    });

    test('accepts an array form too', () => {
        const list = L.seatList([seat('t2_0', 'Dev'), seat('t1_0', 'Rahul')]);
        expect(list.map((s) => s.seatKey)).toEqual(['t1_0', 't2_0']);
    });

    test('empty/absent input → empty list', () => {
        expect(L.seatList(null)).toEqual([]);
        expect(L.seatList({})).toEqual([]);
    });

    test('does not mutate the input seats', () => {
        const seats = { t1_0: { memberName: 'Rahul' } };
        L.seatList(seats);
        expect(seats.t1_0.seatKey).toBeUndefined();
    });
});

describe('roundDocId / docFor', () => {
    test('doc id is {roundIndex}_{seatKey}', () => {
        expect(L.roundDocId(0, 't1_0')).toBe('0_t1_0');
        expect(L.roundDocId(3, 't2_1')).toBe('3_t2_1');
    });

    test('docFor finds a doc keyed by full doc id', () => {
        const docs = { '2_t1_0': requestedDoc() };
        expect(L.docFor(docs, 't1_0', 2)).toBe(docs['2_t1_0']);
    });

    test('docFor falls back to a bare seat-key map', () => {
        const docs = { t1_0: requestedDoc() };
        expect(L.docFor(docs, 't1_0', 2)).toBe(docs.t1_0);
    });

    test('docFor returns null for a miss or junk input', () => {
        expect(L.docFor({}, 't1_0', 0)).toBeNull();
        expect(L.docFor(null, 't1_0', 0)).toBeNull();
    });
});

describe('captureQueue — multi-ghost sequencing', () => {
    const THREE = {
        t2_0: seat('t2_0', 'Dev'),
        t1_0: seat('t1_0', 'Rahul'),
        t1_1: seat('t1_1', 'Priya'),
    };

    test('all three uncaptured → queue in seat-key order', () => {
        const docs = {
            '0_t1_0': requestedDoc(),
            '0_t1_1': requestedDoc(),
            '0_t2_0': requestedDoc(),
        };
        expect(L.captureQueue(THREE, docs, 0).map((s) => s.seatKey))
            .toEqual(['t1_0', 't1_1', 't2_0']);
    });

    test('some captured → only the rest queue, order preserved', () => {
        const docs = {
            '0_t1_0': capturedDoc(),
            '0_t1_1': requestedDoc(),
            '0_t2_0': requestedDoc(),
        };
        expect(L.captureQueue(THREE, docs, 0).map((s) => s.seatKey))
            .toEqual(['t1_1', 't2_0']);
    });

    test('seats with no doc yet still queue — the prompt precedes the shutter', () => {
        // Only t1_1 has asked; the other two have no doc at all. All three
        // still need showing to the camera, so all three queue.
        const docs = { '0_t1_1': requestedDoc() };
        expect(L.captureQueue(THREE, docs, 0).map((s) => s.seatKey))
            .toEqual(['t1_0', 't1_1', 't2_0']);
    });

    test('the very start of a deal — no docs at all — queues every seat', () => {
        expect(L.captureQueue(THREE, {}, 0).map((s) => s.seatKey))
            .toEqual(['t1_0', 't1_1', 't2_0']);
    });

    test('all captured → empty queue', () => {
        const docs = {
            '0_t1_0': capturedDoc(),
            '0_t1_1': capturedDoc(),
            '0_t2_0': capturedDoc(),
        };
        expect(L.captureQueue(THREE, docs, 0)).toEqual([]);
    });

    test('a retake re-queues that seat at its seat-key position', () => {
        const docs = {
            '0_t1_0': capturedDoc(),
            '0_t1_1': capturedDoc({ captureRequest: 2, capturedRequest: 1 }),
            '0_t2_0': requestedDoc(),
        };
        expect(L.captureQueue(THREE, docs, 0).map((s) => s.seatKey))
            .toEqual(['t1_1', 't2_0']);
    });

    test('inactive seats never queue', () => {
        const seats = {
            t1_0: seat('t1_0', 'Rahul', { active: false }),
            t1_1: seat('t1_1', 'Priya'),
        };
        const docs = { '0_t1_0': requestedDoc(), '0_t1_1': requestedDoc() };
        expect(L.captureQueue(seats, docs, 0).map((s) => s.seatKey)).toEqual(['t1_1']);
    });

    test('the queue is scoped to the given round index', () => {
        // Round 0 is captured; round 1 has been requested but not delivered.
        const docs = { '0_t1_0': capturedDoc(), '1_t1_0': requestedDoc() };
        expect(L.captureQueue({ t1_0: THREE.t1_0 }, docs, 0)).toEqual([]);
        expect(L.captureQueue({ t1_0: THREE.t1_0 }, docs, 1).map((s) => s.seatKey))
            .toEqual(['t1_0']);
        // A round with no docs at all is a fresh deal — the seat queues again.
        expect(L.captureQueue({ t1_0: THREE.t1_0 }, docs, 2).map((s) => s.seatKey))
            .toEqual(['t1_0']);
    });
});

describe('capturePrompt — AC: the prompt names the player', () => {
    test('names the head of the queue: "Now show Priya\'s hand"', () => {
        const seats = { t1_1: seat('t1_1', 'Priya') };
        const docs = { '0_t1_1': requestedDoc() };
        expect(L.capturePrompt(seats, docs, 0)).toBe("Now show Priya's hand");
    });

    test('AC: the built string CONTAINS the queued seat\'s memberName', () => {
        const seats = {
            t2_0: seat('t2_0', 'Dev'),
            t1_0: seat('t1_0', 'Rahul'),
            t1_1: seat('t1_1', 'Priya'),
        };
        const docs = {
            '0_t1_0': requestedDoc(),
            '0_t1_1': requestedDoc(),
            '0_t2_0': requestedDoc(),
        };
        // Head of the queue by seat-key order is Rahul.
        const prompt = L.capturePrompt(seats, docs, 0);
        expect(prompt).toContain('Rahul');
        expect(prompt).toBe("Now show Rahul's hand");
        // A bare "next seat" prompt would not satisfy the AC.
        expect(prompt).not.toBe('Now show the next hand');
    });

    test('advances to the next player once the first is captured', () => {
        const seats = {
            t1_0: seat('t1_0', 'Rahul'),
            t1_1: seat('t1_1', 'Priya'),
            t2_0: seat('t2_0', 'Dev'),
        };
        let docs = {
            '0_t1_0': requestedDoc(),
            '0_t1_1': requestedDoc(),
            '0_t2_0': requestedDoc(),
        };
        expect(L.capturePrompt(seats, docs, 0)).toContain('Rahul');

        docs = Object.assign({}, docs, { '0_t1_0': capturedDoc() });
        expect(L.capturePrompt(seats, docs, 0)).toContain('Priya');

        docs = Object.assign({}, docs, { '0_t1_1': capturedDoc() });
        expect(L.capturePrompt(seats, docs, 0)).toContain('Dev');
    });

    test('empty queue → null, and the empty-state line is available', () => {
        const seats = { t1_0: seat('t1_0', 'Rahul') };
        expect(L.capturePrompt(seats, { '0_t1_0': capturedDoc() }, 0)).toBeNull();
        // No seats at all is a non-ghost match — nothing to prompt for.
        expect(L.capturePrompt({}, {}, 0)).toBeNull();
        expect(L.allCapturedLine()).toContain('All hands captured');
    });

    test('§7.3 smoke contract: array-of-seats + no docs still names the player', () => {
        // This is the exact shape of the scripted smoke check:
        //   capturePrompt([{seatKey:'t1_0',memberName:'Priya'}], {}, 0)
        // A fresh deal has written no round docs yet, so it must still prompt.
        expect(L.capturePrompt([{ seatKey: 't1_0', memberName: 'Priya' }], {}, 0))
            .toBe("Now show Priya's hand");
    });

    test('XSS: capturePrompt escapes memberName', () => {
        const seats = { t1_0: seat('t1_0', XSS) };
        const prompt = L.capturePrompt(seats, { '0_t1_0': requestedDoc() }, 0);
        expect(prompt).not.toContain('<');
        expect(prompt).not.toContain('onerror=alert(1)>');
        expect(prompt).toContain('&lt;img');
    });
});

describe('playLine — current position among remaining cards', () => {
    test('first play of an untouched hand announces its photo position', () => {
        // PHOTO_HAND[3] is 'AS' — 4th from the left.
        expect(L.playLine('AS', PHOTO_HAND, ['AS'])).toBe('▶ A♠ — 4th from the left');
    });

    test('positions recompute as the hand depletes (mid-round)', () => {
        // '7S','QH','2C' already gone → remaining starts at 'AS'.
        const played = ['7S', 'QH', '2C', 'AS'];
        // Remaining before pulling AS: AS 9H JD KC 4H 8D AH 3C TS 5D → AS is 1st.
        expect(L.playLine('AS', PHOTO_HAND, played)).toBe('▶ A♠ — 1st from the left');
    });

    test('agrees with Cards.positionOf across a full 13-trick round', () => {
        const played = [];
        // Play the hand in a scrambled order and check every announcement.
        const order = ['JD', '7S', 'TS', 'AH', '2C', '5D', 'QH', 'KC', '9H', '4H', 'AS', '8D', '3C'];
        for (const card of order) {
            const expected = Cards.positionOf(card, PHOTO_HAND, played);
            played.push(card);
            const line = L.playLine(card, PHOTO_HAND, played);
            expect(line).toBe(`▶ ${L.cardLabel(card)} — ${L.ordinal(expected)} from the left`);
        }
        expect(played).toHaveLength(13);
    });

    test('the last card is always 1st from the left', () => {
        const played = PHOTO_HAND.slice(0, 12);
        const last = PHOTO_HAND[12];
        expect(L.playLine(last, PHOTO_HAND, played.concat([last])))
            .toBe('▶ 5♦ — 1st from the left');
    });

    test('renders 10 not T', () => {
        expect(L.playLine('TS', PHOTO_HAND, ['TS'])).toContain('10♠');
        expect(L.playLine('TS', PHOTO_HAND, ['TS'])).not.toContain('T♠');
    });

    test('an 11th/12th/13th position renders with the teens ordinal', () => {
        expect(L.playLine('3C', PHOTO_HAND, ['3C'])).toBe('▶ 3♣ — 11th from the left');
        expect(L.playLine('TS', PHOTO_HAND, ['TS'])).toBe('▶ 10♠ — 12th from the left');
        expect(L.playLine('5D', PHOTO_HAND, ['5D'])).toBe('▶ 5♦ — 13th from the left');
    });

    test('a card not in the hand degrades to a bare announcement', () => {
        expect(L.playLine('KS', PHOTO_HAND, ['KS'])).toBe('▶ K♠');
    });

    test('a null hand degrades rather than throwing', () => {
        expect(() => L.playLine('AS', null, [])).not.toThrow();
        expect(L.playLine('AS', null, [])).toBe('▶ A♠');
    });
});

describe('undoLine — the reinsert position', () => {
    test('announces where the card slides back in', () => {
        // Undoing 'AS' from played ['7S','QH','2C','AS']: packet after undo is
        // AS 9H JD KC ... → AS is 1st.
        expect(L.undoLine('AS', PHOTO_HAND, ['7S', 'QH', '2C', 'AS']))
            .toBe('↩ A♠ taken back — slide it back 1st from the left');
    });

    test('the reinsert position differs from the play position mid-round', () => {
        // Played 'QH' first, then '7S'. Undo 'QH'.
        const played = ['QH', '7S'];
        // After removing QH from played, packet is QH 2C AS ... (7S still gone)
        // → QH is 1st.
        expect(L.undoLine('QH', PHOTO_HAND, played))
            .toBe('↩ Q♥ taken back — slide it back 1st from the left');
        // Whereas its position when played was 2nd (7S still held then).
        expect(L.playLine('QH', PHOTO_HAND, ['QH'])).toBe('▶ Q♥ — 2nd from the left');
    });

    test('agrees with Cards.reinsertPosition mid-round', () => {
        const played = ['JD', '7S', 'TS', 'AH'];
        for (const card of played) {
            const expected = Cards.reinsertPosition(card, PHOTO_HAND, played);
            expect(L.undoLine(card, PHOTO_HAND, played))
                .toBe(`↩ ${L.cardLabel(card)} taken back — slide it back ${L.ordinal(expected)} from the left`);
        }
    });

    test('play then undo of the same card round-trips to the same position', () => {
        const played = ['7S', 'QH', '2C'];
        const withCard = played.concat(['JD']);
        const playPos = L.playLine('JD', PHOTO_HAND, withCard).match(/(\d+)\w\w from/)[1];
        const undoPos = L.undoLine('JD', PHOTO_HAND, withCard).match(/(\d+)\w\w from/)[1];
        expect(undoPos).toBe(playPos);
    });

    test('renders 10 not T and handles the teens ordinal', () => {
        expect(L.undoLine('TS', PHOTO_HAND, ['TS']))
            .toBe('↩ 10♠ taken back — slide it back 12th from the left');
    });

    test('a card never held degrades to a bare announcement', () => {
        expect(L.undoLine('KS', PHOTO_HAND, ['KS'])).toBe('↩ K♠ taken back');
    });
});

describe('resizeTarget — the pure half of the photo pipeline', () => {
    test('AC: a 4032×3024 phone frame downscales to a 1000px long edge', () => {
        expect(L.resizeTarget(4032, 3024)).toEqual({ width: 1000, height: 750 });
    });

    test('AC: a synthetic large canvas never exceeds maxEdge on either side', () => {
        const cases = [[4032, 3024], [1920, 1080], [3000, 3000], [1001, 400], [8000, 200]];
        for (const [w, h] of cases) {
            const t = L.resizeTarget(w, h);
            expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(1000);
        }
    });

    test('a square 1000×1000 image is already at the cap — passes through', () => {
        expect(L.resizeTarget(1000, 1000)).toEqual({ width: 1000, height: 1000 });
    });

    test('a portrait frame caps its height, not its width', () => {
        expect(L.resizeTarget(3024, 4032)).toEqual({ width: 750, height: 1000 });
    });

    test('never upscales a small image', () => {
        expect(L.resizeTarget(640, 480)).toEqual({ width: 640, height: 480 });
        expect(L.resizeTarget(320, 240)).toEqual({ width: 320, height: 240 });
        expect(L.resizeTarget(1, 1)).toEqual({ width: 1, height: 1 });
    });

    test('preserves aspect ratio within rounding', () => {
        const t = L.resizeTarget(4032, 3024);
        expect(t.width / t.height).toBeCloseTo(4032 / 3024, 2);
    });

    test('honours a custom maxEdge', () => {
        expect(L.resizeTarget(4032, 3024, 500)).toEqual({ width: 500, height: 375 });
        expect(L.resizeTarget(4032, 3024, 4032)).toEqual({ width: 4032, height: 3024 });
    });

    test('returns integers', () => {
        const t = L.resizeTarget(1333, 999);
        expect(Number.isInteger(t.width)).toBe(true);
        expect(Number.isInteger(t.height)).toBe(true);
    });

    test('an extreme aspect ratio still clamps to at least 1px', () => {
        const t = L.resizeTarget(10000, 3);
        expect(t.width).toBe(1000);
        expect(t.height).toBeGreaterThanOrEqual(1);
    });

    test('degenerate input yields zeroes rather than throwing', () => {
        expect(L.resizeTarget(0, 0)).toEqual({ width: 0, height: 0 });
        expect(L.resizeTarget(-4, 10)).toEqual({ width: 0, height: 0 });
        expect(L.resizeTarget(NaN, 100)).toEqual({ width: 0, height: 0 });
        expect(L.resizeTarget(100, 100, 0)).toEqual({ width: 0, height: 0 });
    });
});

describe('chooseQuality — the retry ladder, all three branches', () => {
    test('branch 1 — under the cap on the first attempt → accept', () => {
        expect(L.chooseQuality(150000, 0)).toEqual({ action: 'accept' });
    });

    test('exactly at the cap → accept', () => {
        expect(L.chooseQuality(700000, 0)).toEqual({ action: 'accept' });
    });

    test('branch 2 — over the cap at q0.6 → retry at q0.45', () => {
        const d = L.chooseQuality(900000, 0);
        expect(d.action).toBe('retry');
        expect(d.quality).toBe(0.45);
    });

    test('branch 3 — still over at q0.45 → fail with the retake message', () => {
        const d = L.chooseQuality(800000, 1);
        expect(d.action).toBe('fail');
        expect(d.message).toContain('retake');
        expect(d.message).toBe(L.CAPTURE_ERROR_MESSAGE);
    });

    test('the second attempt accepts if it came in under the cap', () => {
        expect(L.chooseQuality(600000, 1)).toEqual({ action: 'accept' });
    });

    test('a full ladder walk: 900k → retry → 800k → fail', () => {
        const first = L.chooseQuality(900000, 0);
        expect(first.action).toBe('retry');
        const second = L.chooseQuality(800000, 1);
        expect(second.action).toBe('fail');
    });

    test('a full ladder walk: 900k → retry → 400k → accept', () => {
        expect(L.chooseQuality(900000, 0).action).toBe('retry');
        expect(L.chooseQuality(400000, 1).action).toBe('accept');
    });

    test('an empty/invalid encode fails rather than writing junk', () => {
        expect(L.chooseQuality(0, 0).action).toBe('fail');
        expect(L.chooseQuality(NaN, 0).action).toBe('fail');
    });

    test('a custom cap is honoured', () => {
        expect(L.chooseQuality(500, 0, 1000)).toEqual({ action: 'accept' });
        expect(L.chooseQuality(5000, 0, 1000).action).toBe('retry');
    });

    test('the message never mentions a promise or blind', () => {
        expect(L.CAPTURE_ERROR_MESSAGE.toLowerCase()).not.toContain('promise');
        expect(L.CAPTURE_ERROR_MESSAGE.toLowerCase()).not.toContain('blind');
    });
});

describe('qualityForAttempt', () => {
    test('walks the documented ladder', () => {
        expect(L.qualityForAttempt(0)).toBe(0.6);
        expect(L.qualityForAttempt(1)).toBe(0.45);
    });

    test('clamps out-of-range attempts to the ends of the ladder', () => {
        expect(L.qualityForAttempt(9)).toBe(0.45);
        expect(L.qualityForAttempt(-1)).toBe(0.6);
    });

    test('the ladder itself is q0.6 then q0.45', () => {
        expect(L.QUALITY_LADDER).toEqual([0.6, 0.45]);
    });
});

describe('setupStrings — the Station Setup copy', () => {
    const s = L.setupStrings();

    test('carries the practicalities line', () => {
        expect(s.power).toContain('plugged in');
        expect(s.power).toContain('screen sleep');
        expect(s.power).toContain('tab open');
    });

    test('carries the voice-call operating requirement verbatim', () => {
        expect(s.voiceCall).toBe(
            'Keep a voice/video call running with your ghost player(s) — '
            + 'turn order travels by voice.'
        );
    });

    test('carries the undo-etiquette line verbatim', () => {
        expect(s.undoEtiquette).toBe(
            'If a taken-back card was already played to the trick, the table '
            + 'rewinds that trick by hand — same as any misplay today.'
        );
    });

    test('the aiming copy states the preview disappears for the match', () => {
        expect(s.aiming).toContain('Station ready');
        expect(s.aiming.toLowerCase()).toContain('preview');
    });

    test('no setup string mentions a promise or blind', () => {
        for (const [key, value] of Object.entries(s)) {
            expect(`${key}: ${value}`.toLowerCase()).not.toContain('promise');
            expect(`${key}: ${value}`.toLowerCase()).not.toContain('blind');
        }
    });
});

describe('card delivery only — the station holds no score-bearing state', () => {
    test('no logic function is named for a promise or blind', () => {
        for (const key of Object.keys(L)) {
            expect(key.toLowerCase()).not.toContain('promise');
            expect(key.toLowerCase()).not.toContain('blind');
        }
    });

    test('no status line ever surfaces a promise or blind, even if the doc carries one', () => {
        // A doc that (wrongly) carried these fields must not leak them.
        const doc = capturedDoc({ cards: PHOTO_HAND, promise: 9, blindDeclared: true });
        const line = L.statusLine(seat('t1_0', 'Rahul'), doc);
        expect(line.toLowerCase()).not.toContain('promise');
        expect(line.toLowerCase()).not.toContain('blind');
        expect(line).not.toContain('9');
    });
});

// ─── BLOCKER 1: retake, end to end against the real service ────────────────

describe('BLOCKER 1 — the station re-prompts after a retake (real service docs)', () => {
    const SEATS = { [FIX_SEAT]: seat(FIX_SEAT, 'Priya') };

    /** Key the doc the way the station's listener map does. */
    const asDocs = (doc) => ({ [`0_${FIX_SEAT}`]: doc });

    test('writePhoto actually persists capturedRequest — the field statusFor reads', async () => {
        const doc = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,AAA', 'Dev', 1);
        });
        expect(doc.capturedRequest).toBe(1);
        expect(doc.captureRequest).toBe(1);
        expect(doc.capturedAt).toBe(SERVER_TS);
    });

    test('the full retake cycle: capture → retake → re-queue → second photo → done', async () => {
        const db = makeDb();
        const svc = new GhostService({ db });
        const read = () => JSON.parse(JSON.stringify(db._store.get(FIX_PATH)));

        // 1. Priya taps 📷. The station is prompted for her hand.
        const req1 = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
        expect(req1).toBe(1);
        expect(L.statusFor(read())).toBe('captured');
        expect(L.capturePrompt(SEATS, asDocs(read()), 0)).toBe("Now show Priya's hand");

        // 2. The station grabs the frame for request #1 and writes it.
        await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,BLURRY', 'Dev', req1);
        expect(L.statusFor(read())).toBe('entering');
        expect(L.captureQueue(SEATS, asDocs(read()), 0)).toEqual([]);
        expect(L.capturePrompt(SEATS, asDocs(read()), 0)).toBeNull();

        // 3. It is blurry. Priya taps Retake → captureRequest increments.
        const req2 = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
        expect(req2).toBe(2);

        // THE REGRESSION: the station must see that it owes another frame.
        const afterRetake = read();
        expect(afterRetake.capturedRequest).toBe(1);
        expect(afterRetake.captureRequest).toBe(2);
        expect(L.statusFor(afterRetake)).toBe('captured');
        expect(L.captureQueue(SEATS, asDocs(afterRetake), 0).map((s) => s.seatKey))
            .toEqual([FIX_SEAT]);
        // She is named again — the physical player is still holding her hand.
        expect(L.capturePrompt(SEATS, asDocs(afterRetake), 0)).toBe("Now show Priya's hand");
        expect(L.statusLine(SEATS[FIX_SEAT], afterRetake))
            .toBe("Showing Priya's hand — waiting for Priya to capture…");

        // 4. Second photo lands, answering request #2. The seat leaves the queue.
        await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,SHARP', 'Dev', req2);
        const afterSecond = read();
        expect(afterSecond.capturedRequest).toBe(2);
        expect(L.statusFor(afterSecond)).toBe('entering');
        expect(L.captureQueue(SEATS, asDocs(afterSecond), 0)).toEqual([]);
        expect(L.capturePrompt(SEATS, asDocs(afterSecond), 0)).toBeNull();
        expect(L.statusLine(SEATS[FIX_SEAT], afterSecond)).toBe('Priya is entering their hand…');
    });

    test('a stale request number from a slow encode still re-queues the seat', async () => {
        // The station grabs a frame for request 1; while the canvas encodes,
        // Priya taps Retake (request 2). The write lands late, tagged 1.
        const db = makeDb();
        const svc = new GhostService({ db });
        await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
        await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);   // retake → 2
        await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,OLD', 'Dev', 1);

        const doc = JSON.parse(JSON.stringify(db._store.get(FIX_PATH)));
        expect(L.statusFor(doc)).toBe('captured');
        expect(L.capturePrompt(SEATS, asDocs(doc), 0)).toBe("Now show Priya's hand");
    });

    test('three ghosts: a retake by the middle seat re-queues only that seat', async () => {
        const db = makeDb();
        const svc = new GhostService({ db });
        const keys = ['t1_0', 't1_1', 't2_0'];
        const seats = {
            t1_0: seat('t1_0', 'Rahul'),
            t1_1: seat('t1_1', 'Priya'),
            t2_0: seat('t2_0', 'Dev'),
        };
        for (const k of keys) {
            const n = await svc.requestCapture(FIX_MATCH, 0, k);
            await svc.writePhoto(FIX_MATCH, 0, k, 'data:image/jpeg;base64,AAA', 'Anil', n);
        }
        const docs = () => keys.reduce((acc, k) => {
            acc[`0_${k}`] = JSON.parse(
                JSON.stringify(db._store.get(`matches/${FIX_MATCH}/ghostRounds/0_${k}`))
            );
            return acc;
        }, {});

        expect(L.captureQueue(seats, docs(), 0)).toEqual([]);

        await svc.requestCapture(FIX_MATCH, 0, 't1_1');   // Priya retakes
        expect(L.captureQueue(seats, docs(), 0).map((s) => s.seatKey)).toEqual(['t1_1']);
        expect(L.capturePrompt(seats, docs(), 0)).toBe("Now show Priya's hand");
    });
});

// ─── MINOR 5: the contract test that prevents this whole class of bug ──────

describe('CONTRACT — every field statusFor reads is a field ghostService writes', () => {
    /**
     * The round-doc fields `logic.statusFor` (and the queue built on it) branch
     * on. Kept as an explicit list so adding a branch that reads a phantom
     * field fails here rather than in a real match.
     */
    const FIELDS_READ = ['playedCards', 'cards', 'captureRequest', 'capturedAt', 'capturedRequest'];

    test('the union of real service writes covers every field statusFor reads', async () => {
        const doc = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,AAA', 'Dev', 1);
            await svc.confirmHand(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND);
            await svc.playCard(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND[0]);
        });

        for (const field of FIELDS_READ) {
            expect(Object.prototype.hasOwnProperty.call(doc, field)).toBe(true);
        }
    });

    test('statusFor branches on no field the service never writes', async () => {
        const written = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,AAA', 'Dev', 1);
            await svc.confirmHand(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND);
            await svc.playCard(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND[0]);
        });
        const writtenFields = new Set(Object.keys(written));

        // Every field the station reads must be in the written set. A field
        // that is read but never written is exactly BLOCKER 1.
        const phantom = FIELDS_READ.filter((f) => !writtenFields.has(f));
        expect(phantom).toEqual([]);
    });

    test('the station-side fixtures match a real service doc field-for-field', async () => {
        const realRequested = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
        });
        expect(Object.keys(realRequested).sort()).toEqual(Object.keys(requestedDoc()).sort());
        expect(realRequested).toEqual(requestedDoc());

        const realCaptured = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,AAA', 'Dev', 1);
        });
        expect(Object.keys(realCaptured).sort()).toEqual(Object.keys(capturedDoc()).sort());
        expect(realCaptured).toEqual(capturedDoc());
    });

    test('every status the station can show is reachable from real service calls', async () => {
        const seen = [];

        seen.push(L.statusFor(null));                                   // waiting-deal
        seen.push(L.statusFor(await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
        })));                                                            // captured
        seen.push(L.statusFor(await realDoc(async (svc) => {
            const n = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,A', 'Dev', n);
        })));                                                            // entering
        seen.push(L.statusFor(await realDoc(async (svc) => {
            const n = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,A', 'Dev', n);
            await svc.confirmHand(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND);
        })));                                                            // ready
        seen.push(L.statusFor(await realDoc(async (svc) => {
            const n = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,A', 'Dev', n);
            await svc.confirmHand(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND);
            await svc.playCard(FIX_MATCH, 0, FIX_SEAT, PHOTO_HAND[0]);
        })));                                                            // playing
        seen.push(L.statusFor(await realDoc(async (svc) => {
            const n = await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,A', 'Dev', n);
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);            // retake
        })));                                                            // captured again

        expect(seen).toEqual([
            'waiting-deal', 'captured', 'entering', 'ready', 'playing', 'captured',
        ]);
    });

    test('the legacy branch is not the branch a current write takes', async () => {
        const doc = await realDoc(async (svc) => {
            await svc.requestCapture(FIX_MATCH, 0, FIX_SEAT);
            await svc.writePhoto(FIX_MATCH, 0, FIX_SEAT, 'data:image/jpeg;base64,A', 'Dev', 1);
        });
        // Current writes always carry a finite capturedRequest, so the
        // legacy-tolerance path is unreachable for them.
        expect(Number.isFinite(Number(doc.capturedRequest))).toBe(true);

        // The legacy path itself still degrades gracefully for an old doc.
        const legacy = { ...doc, captureRequest: 3 };
        delete legacy.capturedRequest;
        expect(L.statusFor(legacy)).toBe('entering');
    });
});

describe('MINOR 6 — possessive decides on the raw name, escapes the name once', () => {
    test('a name ending in a double quote is not mangled', () => {
        // Pre-fix this produced `Ross&quot;'s` — the s-rule was inspecting the
        // `;` at the end of the entity rather than the `"` in the real name.
        // The raw name ends in `"`, not `s`, so it correctly takes `'s`, and
        // the quote itself is escaped exactly once.
        expect(L.possessive({ memberName: 'Ross"' })).toBe("Ross&quot;'s");
    });

    test('a name ending in an escaped-to-s-like entity still uses the raw character', () => {
        // `Chris&` escapes to `Chris&amp;` — which ends in `;`. The rule must
        // read the raw `&`, so this takes `'s`, not a bare apostrophe.
        expect(L.possessive({ memberName: 'Chris&' })).toBe("Chris&amp;'s");
        // And a genuinely s-ending name still takes the bare apostrophe.
        expect(L.possessive({ memberName: 'Chris' })).toBe("Chris'");
    });

    test('ordinary names are unchanged in behaviour', () => {
        expect(L.possessive({ memberName: 'Rahul' })).toBe("Rahul's");
        expect(L.possessive({ memberName: '  Priya  ' })).toBe("Priya's");
        expect(L.possessive({})).toBe("this player's");
        expect(L.possessive(null)).toBe("this player's");
    });

    test('the escaping regime is intact — single-pass, never double-escaped', () => {
        expect(L.possessive({ memberName: 'A&B' })).toBe("A&amp;B's");
        // `&amp;amp;` would mean the name went through escapeHtml twice.
        expect(L.possessive({ memberName: 'A&B' })).not.toContain('&amp;amp;');
        // The name's own apostrophe is escaped; only our literal stays literal.
        expect(L.possessive({ memberName: "O'Neil" })).toBe("O&#39;Neil's");
    });

    test('XSS: the <img onerror> payload stays inert through the possessive path', () => {
        const line = L.statusLine(seat('t1_0', XSS), requestedDoc());
        expect(line).not.toContain('<');
        expect(line).not.toContain('onerror=alert(1)>');
        expect(line).toContain('&lt;img');

        const prompt = L.capturePrompt({ t1_0: seat('t1_0', XSS) }, { '0_t1_0': requestedDoc() }, 0);
        expect(prompt).not.toContain('<');
        expect(prompt).toContain('&lt;img');
    });

    test('XSS: an apostrophe payload cannot break out of an attribute', () => {
        const payload = `Ross' onmouseover='alert(1)`;
        for (const built of [
            L.statusLine(seat('t1_0', payload), requestedDoc()),
            L.statusLine(seat('t1_0', payload), null),
            L.capturePrompt({ t1_0: seat('t1_0', payload) }, { '0_t1_0': requestedDoc() }, 0),
        ]) {
            // Both of the payload's apostrophes are escaped — the attribute
            // break-out is dead.
            expect(built).not.toContain("Ross' onmouseover");
            expect(built).not.toContain("='alert(1)");
            expect(built.match(/&#39;/g).length).toBeGreaterThanOrEqual(2);
            // Any literal apostrophe left is one this module wrote itself: it
            // is always immediately followed by `s ` or by end-of-possessive.
            for (const m of built.matchAll(/'/g)) {
                expect(built.slice(m.index, m.index + 3)).toMatch(/^'s /);
            }
        }
    });
});

describe('MINOR 7 — Cards is resolved lazily, never bound eagerly to null', () => {
    test('the module late-binds via globalThis rather than capturing a const', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostStation.js'), 'utf8'
        );
        expect(source).toContain('globalThis.Cards');
        // No eager capture of the dependency into a module-scope const.
        expect(source).not.toMatch(/^\s*const C = \(typeof Cards/m);
    });

    test('a missing Cards throws loudly instead of silently degrading', () => {
        const saved = globalThis.Cards;
        try {
            delete globalThis.Cards;
            // The failure mode being prevented: 'TS' printed as "TS", and a
            // play line with no position at all.
            expect(() => L.cardLabel('TS')).toThrow(/cards\.js/);
            expect(() => L.playLine('AS', PHOTO_HAND, ['AS'])).toThrow(/cards\.js/);
            expect(() => L.undoLine('AS', PHOTO_HAND, ['AS'])).toThrow(/cards\.js/);
        } finally {
            globalThis.Cards = saved;
        }
    });

    test('a Cards that arrives after this module loaded is picked up', () => {
        const saved = globalThis.Cards;
        try {
            delete globalThis.Cards;
            expect(() => L.cardLabel('TS')).toThrow();
            globalThis.Cards = saved;                 // late script order
            expect(L.cardLabel('TS')).toBe('10♠');    // works, no reload needed
        } finally {
            globalThis.Cards = saved;
        }
    });
});

describe('§7.3 smoke — the module is DOM-free', () => {
    test('importing and calling logic touches no window/document', () => {
        expect(typeof window).toBe('undefined');
        expect(typeof document).toBe('undefined');
        expect(L.capturePrompt({ t1_0: seat('t1_0', 'Priya') }, { '0_t1_0': requestedDoc() }, 0))
            .toBe("Now show Priya's hand");
    });

    test('the P2 DOM stubs exist and do not throw when called', () => {
        for (const fn of ['init', 'startCamera', 'renderSetup', 'grabFrame',
            'watchShutter', 'render', 'beep', 'destroy']) {
            expect(typeof GhostStation[fn]).toBe('function');
            expect(() => GhostStation[fn]()).not.toThrow();
        }
    });
});
