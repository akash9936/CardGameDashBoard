const GhostSeatView = require('../js/components/ghostSeatView.js');
const Cards = require('../js/utils/cards.js');

const { logic } = GhostSeatView;
const { SCREENS } = logic;

// A realistic 13-card hand in photo order (left → right as fanned for the
// camera). Deliberately unsorted: photo order is whatever the deal produced,
// and preserving it exactly is what makes "5th from the left" work.
const PHOTO_HAND = [
    '7S', 'QH', '2C', 'AS', '9H', 'JD', 'KC', '4H', '8D', 'AH', '3C', 'TS', '5D',
];

/** A round doc with a landed photo and nothing entered yet. */
function capturedDoc(overrides = {}) {
    return {
        captureRequest: 1,
        capturedAt: 1000,
        capturedBy: 'Rahul',
        cards: null,
        confirmedAt: null,
        playedCards: [],
        ...overrides,
    };
}

/** A round doc with the hand confirmed. */
function confirmedDoc(overrides = {}) {
    return capturedDoc({
        cards: PHOTO_HAND.slice(),
        confirmedAt: 2000,
        ...overrides,
    });
}

/** Local state that has already accepted the photo of `doc`. */
function acceptedState(doc, overrides = {}) {
    return {
        ...logic.initialState(),
        photoAccepted: true,
        acceptedSeq: logic.captureSeq(doc),
        ...overrides,
    };
}

/** Tap a list of cards into the entry tray, grid-side. */
function enterCards(state, cards) {
    return cards.reduce(
        (s, card) => logic.reduce(s, { type: 'toggle', card, source: 'grid' }).state,
        state
    );
}

describe('screen derivation (WP5)', () => {
    test('no round doc → WAITING_CAPTURE, never blank or error', () => {
        expect(logic.deriveState(null, logic.initialState())).toBe(SCREENS.WAITING_CAPTURE);
        expect(logic.deriveState(undefined, logic.initialState())).toBe(SCREENS.WAITING_CAPTURE);
    });

    test('doc exists but no photo yet → WAITING_CAPTURE', () => {
        const doc = { captureRequest: 1, capturedAt: null, playedCards: [] };
        expect(logic.deriveState(doc, logic.initialState())).toBe(SCREENS.WAITING_CAPTURE);
    });

    test('photo landed, not yet accepted → PHOTO_REVIEW', () => {
        expect(logic.deriveState(capturedDoc(), logic.initialState())).toBe(SCREENS.PHOTO_REVIEW);
    });

    test('photo accepted, hand not entered → ENTER', () => {
        const doc = capturedDoc();
        expect(logic.deriveState(doc, acceptedState(doc))).toBe(SCREENS.ENTER);
    });

    test('hand confirmed, nothing played → ARRANGE', () => {
        const doc = confirmedDoc();
        expect(logic.deriveState(doc, acceptedState(doc))).toBe(SCREENS.ARRANGE);
    });

    test('first card played → PLAY', () => {
        const doc = confirmedDoc({ playedCards: ['7S'] });
        expect(logic.deriveState(doc, acceptedState(doc))).toBe(SCREENS.PLAY);
    });

    test('a partial hand on the doc still reads as ENTER', () => {
        const doc = confirmedDoc({ cards: PHOTO_HAND.slice(0, 9) });
        expect(logic.deriveState(doc, acceptedState(doc))).toBe(SCREENS.ENTER);
    });

    test('acceptance is bound to its photo — a retake bumps the seq back to review', () => {
        const doc = capturedDoc({ captureRequest: 1 });
        const state = acceptedState(doc);
        expect(logic.deriveState(doc, state)).toBe(SCREENS.ENTER);

        // Station answers a retake: same doc, higher capture sequence.
        const retaken = capturedDoc({ captureRequest: 2, capturedAt: 3000 });
        expect(logic.deriveState(retaken, state)).toBe(SCREENS.PHOTO_REVIEW);
    });
});

describe('capture loop (WP5)', () => {
    test('requestCapture emits the shutter effect', () => {
        const { effects } = logic.reduce(logic.initialState(), { type: 'requestCapture' });
        expect(effects).toEqual([{ type: 'requestCapture' }]);
    });

    test('acceptPhoto records the sequence it accepted', () => {
        const doc = capturedDoc({ captureRequest: 3 });
        const { state, effects } = logic.reduce(
            logic.initialState(), { type: 'acceptPhoto', doc }
        );
        expect(state.photoAccepted).toBe(true);
        expect(state.acceptedSeq).toBe(3);
        expect(effects).toEqual([]);
    });

    test('acceptPhoto is a no-op when no photo has landed', () => {
        const before = logic.initialState();
        const { state, effects } = logic.reduce(before, {
            type: 'acceptPhoto',
            doc: { captureRequest: 1, capturedAt: null },
        });
        expect(state).toBe(before);
        expect(effects).toEqual([]);
    });

    test('retake resets ENTER progress and re-fires the shutter', () => {
        const doc = capturedDoc();
        let state = acceptedState(doc);
        state = enterCards(state, ['7S', 'QH', '2C', 'AS']);
        expect(state.entry).toHaveLength(4);

        const out = logic.reduce(state, { type: 'retake', doc });
        expect(out.state.entry).toEqual([]);
        expect(out.state.photoAccepted).toBe(false);
        expect(out.state.acceptedSeq).toBeNull();
        expect(out.effects).toEqual([{ type: 'requestCapture' }]);

        // And the screen falls back to waiting for the new photo.
        const pending = { ...doc, capturedAt: null };
        expect(logic.deriveState(pending, out.state)).toBe(SCREENS.WAITING_CAPTURE);
    });

    test('retake AFTER confirm also clears the stale cards on the server', () => {
        const doc = confirmedDoc();
        const state = acceptedState(doc);

        const out = logic.reduce(state, { type: 'retake', doc });
        expect(out.effects).toEqual([
            { type: 'requestCapture' },
            { type: 'clearCards' },
        ]);
        expect(out.state.entry).toEqual([]);
        expect(out.state.displayOrder).toEqual([]);
        expect(out.state.fixing).toBe(false);
    });

    test('retake before any confirm does not emit clearCards', () => {
        const doc = capturedDoc();
        const out = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(out.effects.some((e) => e.type === 'clearCards')).toBe(false);
    });
});

describe('entry reducer (WP6)', () => {
    test('toggle appends in tap order', () => {
        const state = enterCards(logic.initialState(), ['QH', '7S', 'AS']);
        expect(state.entry).toEqual(['QH', '7S', 'AS']);
    });

    test('a grid tap on an already-entered card is a no-op (dimmed, untappable)', () => {
        const before = enterCards(logic.initialState(), ['QH', '7S']);
        const { state, effects } = logic.reduce(before, {
            type: 'toggle', card: 'QH', source: 'grid',
        });
        expect(state).toBe(before);
        expect(state.entry).toEqual(['QH', '7S']);
        expect(effects).toEqual([]);
    });

    test('a tray tap removes the card, leaving the rest in order', () => {
        const before = enterCards(logic.initialState(), ['QH', '7S', 'AS']);
        const { state } = logic.reduce(before, {
            type: 'toggle', card: '7S', source: 'tray',
        });
        expect(state.entry).toEqual(['QH', 'AS']);
    });

    test('duplicates are structurally impossible across many taps', () => {
        let state = logic.initialState();
        // Hammer the same card from the grid repeatedly.
        for (let i = 0; i < 10; i++) {
            state = logic.reduce(state, { type: 'toggle', card: 'AS', source: 'grid' }).state;
        }
        expect(state.entry).toEqual(['AS']);
    });

    test('invalid codes are rejected', () => {
        const before = logic.initialState();
        for (const junk of ['as', 'ZZ', '', null, undefined, 7, '10H']) {
            const { state } = logic.reduce(before, { type: 'toggle', card: junk, source: 'grid' });
            expect(state.entry).toEqual([]);
        }
    });

    test('the tray hard-stops at 13 — a 14th tap has nowhere to go', () => {
        const full = enterCards(logic.initialState(), PHOTO_HAND);
        expect(full.entry).toHaveLength(13);

        const { state } = logic.reduce(full, { type: 'toggle', card: '6C', source: 'grid' });
        expect(state).toBe(full);
        expect(state.entry).toHaveLength(13);
    });

    test('undoLast removes the most recent entry only', () => {
        const before = enterCards(logic.initialState(), ['QH', '7S', 'AS']);
        const { state } = logic.reduce(before, { type: 'undoLast' });
        expect(state.entry).toEqual(['QH', '7S']);
    });

    test('undoLast on an empty tray is a no-op', () => {
        const before = logic.initialState();
        const { state, effects } = logic.reduce(before, { type: 'undoLast' });
        expect(state).toBe(before);
        expect(effects).toEqual([]);
    });

    test('canConfirm is true only at exactly 13 valid cards', () => {
        expect(logic.canConfirm(enterCards(logic.initialState(), PHOTO_HAND.slice(0, 12)))).toBe(false);
        expect(logic.canConfirm(enterCards(logic.initialState(), PHOTO_HAND))).toBe(true);
    });
});

describe('the 13-lock: a 12- or 14-card confirm is unreachable', () => {
    test('confirm at 12 emits nothing', () => {
        const state = enterCards(logic.initialState(), PHOTO_HAND.slice(0, 12));
        expect(state.entry).toHaveLength(12);
        const { effects } = logic.reduce(state, { type: 'confirm' });
        expect(effects).toEqual([]);
    });

    test('confirm at 0 emits nothing', () => {
        const { effects } = logic.reduce(logic.initialState(), { type: 'confirm' });
        expect(effects).toEqual([]);
    });

    test('no sequence of taps can build a 14-card tray, so no 14-card confirm exists', () => {
        // Try to overfill from every angle: the whole deck, tapped in order.
        let state = logic.initialState();
        for (const code of Cards.DECK) {
            state = logic.reduce(state, { type: 'toggle', card: code, source: 'grid' }).state;
        }
        expect(state.entry).toHaveLength(13);

        const { effects } = logic.reduce(state, { type: 'confirm' });
        expect(effects).toHaveLength(1);
        expect(effects[0].cards).toHaveLength(13);
    });

    test('a hand-crafted 14-card tray still cannot confirm', () => {
        // Even if a buggy DOM layer forged the state, the reducer refuses.
        const forged = { ...logic.initialState(), entry: PHOTO_HAND.concat(['6C']) };
        expect(forged.entry).toHaveLength(14);
        expect(logic.reduce(forged, { type: 'confirm' }).effects).toEqual([]);
    });

    test('a forged 13-card tray containing a duplicate cannot confirm', () => {
        const forged = {
            ...logic.initialState(),
            entry: PHOTO_HAND.slice(0, 12).concat(['7S']),   // 7S twice
        };
        expect(forged.entry).toHaveLength(13);
        expect(logic.reduce(forged, { type: 'confirm' }).effects).toEqual([]);
    });
});

describe('confirm payload preserves entry order (WP6)', () => {
    test('confirmHand carries the cards in entry order, NOT sorted', () => {
        const state = enterCards(logic.initialState(), PHOTO_HAND);
        const { effects } = logic.reduce(state, { type: 'confirm' });

        expect(effects).toEqual([{ type: 'confirmHand', cards: PHOTO_HAND }]);
        // Explicitly not the sorted orders — photo order is the physical order.
        expect(effects[0].cards).not.toEqual(Cards.sortBySuit(PHOTO_HAND));
        expect(effects[0].cards).not.toEqual(Cards.sortByRank(PHOTO_HAND));
    });

    test('order survives removals and re-entry', () => {
        let state = enterCards(logic.initialState(), PHOTO_HAND);
        // Remove two from the middle via the tray, then re-add them at the end.
        state = logic.reduce(state, { type: 'toggle', card: '9H', source: 'tray' }).state;
        state = logic.reduce(state, { type: 'toggle', card: 'KC', source: 'tray' }).state;
        state = enterCards(state, ['9H', 'KC']);

        const expected = PHOTO_HAND
            .filter((c) => c !== '9H' && c !== 'KC')
            .concat(['9H', 'KC']);
        const { effects } = logic.reduce(state, { type: 'confirm' });
        expect(effects[0].cards).toEqual(expected);
    });

    test('the confirm payload is a copy — later taps cannot mutate it', () => {
        const state = enterCards(logic.initialState(), PHOTO_HAND);
        const { effects } = logic.reduce(state, { type: 'confirm' });
        const payload = effects[0].cards;

        logic.reduce(state, { type: 'undoLast' });
        expect(payload).toEqual(PHOTO_HAND);
        expect(payload).not.toBe(state.entry);
    });
});

describe('multi-ghost overlap cross-check (WP6)', () => {
    test('no other seats → no warning', () => {
        expect(logic.overlapWarning(PHOTO_HAND, [])).toBeNull();
        expect(logic.overlapWarning(PHOTO_HAND, null)).toBeNull();
        expect(logic.overlapWarning(PHOTO_HAND, undefined)).toBeNull();
    });

    test('disjoint hands → no warning', () => {
        const other = ['6S', '5S', '4S', '3S', '2S', 'KH', 'JH', 'TH', 'AD', 'KD', 'QD', 'AC', 'QC'];
        expect(logic.overlapWarning(PHOTO_HAND, [{ memberName: 'Priya', cards: other }])).toBeNull();
    });

    test('one overlapping card names the player and the card', () => {
        const other = ['QH', '6S', '5S', '4S', '3S', '2S', 'KH', 'JH', 'TH', 'AD', 'KD', 'QD', 'AC'];
        const warning = logic.overlapWarning(PHOTO_HAND, [{ memberName: 'Priya', cards: other }]);
        // The possessive apostrophe is our own literal, not part of the
        // untrusted name, so it stays readable; only `memberName` is escaped.
        expect(warning).toBe(
            "Priya's hand also claims Q♥ — one of you mis-entered; check your photos"
        );
    });

    test('several overlapping cards are all listed, in the other hand’s order', () => {
        const other = ['QH', 'AS', '2C', '6S', '5S', '4S', '3S', '2S', 'KH', 'JH', 'TH', 'AD', 'KD'];
        const warning = logic.overlapWarning(PHOTO_HAND, [{ memberName: 'Dev', cards: other }]);
        expect(warning).toContain('Q♥, A♠, 2♣');
        expect(warning).toContain('Dev');
        expect(warning).toContain('one of you mis-entered; check your photos');
    });

    test('the ten is displayed as 10, never as T', () => {
        const other = ['TS', '6S', '5S', '4S', '3S', '2S', 'KH', 'JH', 'TH', 'AD', 'KD', 'QD', 'AC'];
        const warning = logic.overlapWarning(PHOTO_HAND, [{ memberName: 'Priya', cards: other }]);
        expect(warning).toContain('10♠');
        expect(warning).not.toContain('T♠');
    });

    test('multiple other seats each produce their own clause', () => {
        const seats = [
            { memberName: 'Priya', cards: ['QH', '6S', '5S'] },
            { memberName: 'Dev', cards: ['AS', '4S', '3S'] },
        ];
        const warning = logic.overlapWarning(PHOTO_HAND, seats);
        expect(warning).toContain('Priya');
        expect(warning).toContain('Q♥');
        expect(warning).toContain('Dev');
        expect(warning).toContain('A♠');
        expect(warning).toContain(' · ');
    });

    test('only the clashing seats appear — clean seats are silent', () => {
        const seats = [
            { memberName: 'Clean', cards: ['6S', '5S', '4S'] },
            { memberName: 'Dirty', cards: ['AS', '3S', '2S'] },
        ];
        const warning = logic.overlapWarning(PHOTO_HAND, seats);
        expect(warning).not.toContain('Clean');
        expect(warning).toContain('Dirty');
    });

    test('a duplicated card in the other hand is reported once', () => {
        const seats = [{ memberName: 'Priya', cards: ['QH', 'QH', 'QH'] }];
        const warning = logic.overlapWarning(PHOTO_HAND, seats);
        expect(warning.match(/Q♥/g)).toHaveLength(1);
    });

    test('the other player’s name is escaped — XSS payload is inert', () => {
        const payload = '<img src=x onerror="alert(\'xss\')">';
        const warning = logic.overlapWarning(PHOTO_HAND, [{ memberName: payload, cards: ['QH'] }]);

        expect(warning).not.toContain('<img');
        expect(warning).not.toContain('onerror="');
        expect(warning).toContain('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;');
    });

    test('all five replacements are applied to the name', () => {
        const warning = logic.overlapWarning(['QH'], [{ memberName: `&<>"'`, cards: ['QH'] }]);
        expect(warning).toContain('&amp;&lt;&gt;&quot;&#39;');
    });

    test('a missing name degrades to a neutral label rather than "undefined"', () => {
        const warning = logic.overlapWarning(PHOTO_HAND, [{ cards: ['QH'] }]);
        expect(warning).toContain('Another player');
        expect(warning).not.toContain('undefined');
    });

    test('malformed seat entries are skipped, not thrown on', () => {
        const seats = [null, undefined, {}, { memberName: 'X' }, { cards: 'nope' }];
        expect(() => logic.overlapWarning(PHOTO_HAND, seats)).not.toThrow();
        expect(logic.overlapWarning(PHOTO_HAND, seats)).toBeNull();
    });

    test('the warning rides along with confirm and never blocks it', () => {
        const state = enterCards(logic.initialState(), PHOTO_HAND);
        const { state: next, effects } = logic.reduce(state, {
            type: 'confirm',
            otherSeats: [{ memberName: 'Priya', cards: ['QH'] }],
        });

        // Warned...
        expect(next.warning).toContain('Q♥');
        // ...but the hand was still confirmed.
        expect(effects).toEqual([{ type: 'confirmHand', cards: PHOTO_HAND }]);
    });

    test('dismissWarning clears it', () => {
        const warned = { ...logic.initialState(), warning: 'something' };
        expect(logic.reduce(warned, { type: 'dismissWarning' }).state.warning).toBeNull();
    });
});

describe('mergeDisplayOrder reconciliation (WP7)', () => {
    test('empty storage → photo order', () => {
        expect(logic.mergeDisplayOrder([], PHOTO_HAND)).toEqual(PHOTO_HAND);
    });

    test('non-array / junk storage → photo order', () => {
        for (const junk of [null, undefined, 'AS,KH', 42, {}]) {
            expect(logic.mergeDisplayOrder(junk, PHOTO_HAND)).toEqual(PHOTO_HAND);
        }
    });

    test('a valid full arrangement is preserved exactly', () => {
        const arranged = Cards.sortBySuit(PHOTO_HAND);
        expect(logic.mergeDisplayOrder(arranged, PHOTO_HAND)).toEqual(arranged);
    });

    test('a stale card in storage is dropped', () => {
        const stale = ['6C'].concat(PHOTO_HAND);   // 6C is not in the hand
        const merged = logic.mergeDisplayOrder(stale, PHOTO_HAND);
        expect(merged).not.toContain('6C');
        expect(merged).toEqual(PHOTO_HAND);
    });

    test('a missing card is appended in photo order', () => {
        const partial = PHOTO_HAND.slice(0, 10);
        const merged = logic.mergeDisplayOrder(partial, PHOTO_HAND);
        expect(merged).toHaveLength(13);
        expect(merged.slice(0, 10)).toEqual(partial);
        expect(merged.slice(10)).toEqual(PHOTO_HAND.slice(10));
    });

    test('duplicates in storage collapse to one', () => {
        const dupey = ['AS', 'AS', 'AS'].concat(PHOTO_HAND);
        const merged = logic.mergeDisplayOrder(dupey, PHOTO_HAND);
        expect(merged).toHaveLength(13);
        expect(merged.filter((c) => c === 'AS')).toHaveLength(1);
        expect(merged[0]).toBe('AS');
    });

    test('wrong-length storage (too long, all junk) still yields the exact hand', () => {
        const junk = Array.from({ length: 60 }, (_, i) => Cards.DECK[i % 52]);
        const merged = logic.mergeDisplayOrder(junk, PHOTO_HAND);
        expect(merged).toHaveLength(13);
        expect(new Set(merged)).toEqual(new Set(PHOTO_HAND));
    });

    test('the result is ALWAYS a permutation of the hand — never loses or invents a card', () => {
        const corruptions = [
            [], null, ['ZZ', 'zz'], PHOTO_HAND.slice().reverse(),
            ['6C', '5C', '4C'], PHOTO_HAND.concat(PHOTO_HAND),
            ['AS'], Cards.DECK,
        ];
        for (const stored of corruptions) {
            const merged = logic.mergeDisplayOrder(stored, PHOTO_HAND);
            expect(merged).toHaveLength(PHOTO_HAND.length);
            expect(new Set(merged)).toEqual(new Set(PHOTO_HAND));
        }
    });

    test('an empty hand yields an empty order regardless of storage', () => {
        expect(logic.mergeDisplayOrder(PHOTO_HAND, [])).toEqual([]);
        expect(logic.mergeDisplayOrder(PHOTO_HAND, null)).toEqual([]);
    });

    test('does not mutate its inputs', () => {
        const stored = ['6C'].concat(PHOTO_HAND.slice(0, 5));
        const storedCopy = stored.slice();
        const hand = PHOTO_HAND.slice();
        logic.mergeDisplayOrder(stored, hand);
        expect(stored).toEqual(storedCopy);
        expect(hand).toEqual(PHOTO_HAND);
    });
});

describe('arrange helpers (WP7)', () => {
    test('applySort by suit and by rank', () => {
        expect(logic.applySort(PHOTO_HAND, 'suit')).toEqual(Cards.sortBySuit(PHOTO_HAND));
        expect(logic.applySort(PHOTO_HAND, 'rank')).toEqual(Cards.sortByRank(PHOTO_HAND));
    });

    test('an unknown sort mode leaves the order alone', () => {
        expect(logic.applySort(PHOTO_HAND, 'nonsense')).toEqual(PHOTO_HAND);
        expect(logic.applySort(PHOTO_HAND)).toEqual(PHOTO_HAND);
    });

    test('applySort does not mutate the input', () => {
        const order = PHOTO_HAND.slice();
        logic.applySort(order, 'suit');
        expect(order).toEqual(PHOTO_HAND);
    });

    test('reorder moves a card forward and backward', () => {
        const order = ['A', 'B', 'C', 'D'];
        expect(logic.reorder(order, 0, 2)).toEqual(['B', 'C', 'A', 'D']);
        expect(logic.reorder(order, 3, 0)).toEqual(['D', 'A', 'B', 'C']);
    });

    test('reorder to the same slot is identity', () => {
        expect(logic.reorder(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'B', 'C']);
    });

    test('reorder with out-of-range or junk indices is a no-op', () => {
        const order = ['A', 'B', 'C'];
        for (const [from, to] of [[-1, 1], [5, 1], [0, 9], [0, -2], ['x', 1], [0, null], [1.5, 0]]) {
            expect(logic.reorder(order, from, to)).toEqual(order);
        }
    });

    test('reorder never mutates the input and always keeps every card', () => {
        const order = PHOTO_HAND.slice();
        const moved = logic.reorder(order, 0, 12);
        expect(order).toEqual(PHOTO_HAND);
        expect(new Set(moved)).toEqual(new Set(PHOTO_HAND));
        expect(moved).toHaveLength(13);
    });

    test('sort emits a saveDisplayOrder effect (localStorage only, never the service)', () => {
        const doc = confirmedDoc();
        const { state, effects } = logic.reduce(acceptedState(doc), {
            type: 'sort', mode: 'suit', doc,
        });
        expect(effects).toEqual([{ type: 'saveDisplayOrder', order: Cards.sortBySuit(PHOTO_HAND) }]);
        expect(state.displayOrder).toEqual(Cards.sortBySuit(PHOTO_HAND));
        // Nothing that touches the server.
        expect(effects.some((e) => ['confirmHand', 'playCard'].includes(e.type))).toBe(false);
    });

    test('reorder emits a saveDisplayOrder effect built on the merged order', () => {
        const doc = confirmedDoc();
        const { state, effects } = logic.reduce(acceptedState(doc), {
            type: 'reorder', fromIndex: 0, toIndex: 3, doc,
        });
        expect(effects[0].type).toBe('saveDisplayOrder');
        expect(state.displayOrder).toEqual(logic.reorder(PHOTO_HAND, 0, 3));
    });

    test('sort/reorder are no-ops with no confirmed hand', () => {
        const before = logic.initialState();
        expect(logic.reduce(before, { type: 'sort', mode: 'suit', doc: capturedDoc() }).state).toBe(before);
        expect(logic.reduce(before, { type: 'reorder', fromIndex: 0, toIndex: 1, doc: null }).state).toBe(before);
    });
});

describe('play + undo (WP7)', () => {
    test('playing a held card emits playCard', () => {
        const doc = confirmedDoc();
        const { effects } = logic.reduce(acceptedState(doc), { type: 'play', card: 'QH', doc });
        expect(effects).toEqual([{ type: 'playCard', card: 'QH' }]);
    });

    test('playing an unheld card is unreachable', () => {
        const doc = confirmedDoc();
        const before = acceptedState(doc);
        const { state, effects } = logic.reduce(before, { type: 'play', card: '6C', doc });
        expect(state).toBe(before);
        expect(effects).toEqual([]);
    });

    test('playing an already-played card is unreachable', () => {
        const doc = confirmedDoc({ playedCards: ['QH'] });
        const { effects } = logic.reduce(acceptedState(doc), { type: 'play', card: 'QH', doc });
        expect(effects).toEqual([]);
    });

    test('every card in the hand is playable exactly once across a full round', () => {
        const played = [];
        for (const card of PHOTO_HAND) {
            const doc = confirmedDoc({ playedCards: played.slice() });
            const { effects } = logic.reduce(acceptedState(doc), { type: 'play', card, doc });
            expect(effects).toEqual([{ type: 'playCard', card }]);
            played.push(card);

            // Immediately replaying it is refused.
            const after = confirmedDoc({ playedCards: played.slice() });
            expect(logic.reduce(acceptedState(after), { type: 'play', card, doc: after }).effects)
                .toEqual([]);
        }
        expect(played).toHaveLength(13);
    });

    test('play is a no-op with no doc or no confirmed hand', () => {
        const before = logic.initialState();
        expect(logic.reduce(before, { type: 'play', card: 'QH', doc: null }).effects).toEqual([]);
        expect(logic.reduce(before, { type: 'play', card: 'QH', doc: capturedDoc() }).effects).toEqual([]);
    });

    test('undoLastCard emits the pop effect while cards have been played', () => {
        const doc = confirmedDoc({ playedCards: ['7S', 'QH'] });
        const { effects } = logic.reduce(acceptedState(doc), { type: 'undoLastCard', doc });
        expect(effects).toEqual([{ type: 'undoLastCard' }]);
    });

    test('undoLastCard on an empty played list is unreachable', () => {
        const doc = confirmedDoc({ playedCards: [] });
        const before = acceptedState(doc);
        const { state, effects } = logic.reduce(before, { type: 'undoLastCard', doc });
        expect(state).toBe(before);
        expect(effects).toEqual([]);
    });

    test('undo returns the exact card to the hand, in its display position', () => {
        const displayOrder = Cards.sortBySuit(PHOTO_HAND);
        const state = { ...logic.initialState(), displayOrder };

        const before = confirmedDoc({ playedCards: ['7S', 'QH'] });
        const beforeHand = logic.remainingInDisplayOrder(state.displayOrder, before);
        expect(beforeHand).not.toContain('QH');

        // Service pops the last entry; the listener delivers the new doc.
        const after = confirmedDoc({ playedCards: ['7S'] });
        const afterHand = logic.remainingInDisplayOrder(state.displayOrder, after);

        expect(afterHand).toContain('QH');
        expect(afterHand).toHaveLength(beforeHand.length + 1);
        // Back in its arranged slot, not appended at the end.
        expect(afterHand).toEqual(displayOrder.filter((c) => c !== '7S'));
        // And localStorage was never involved: no effect, same displayOrder.
        expect(state.displayOrder).toEqual(displayOrder);
    });

    test('remainingInDisplayOrder filters display order by server truth', () => {
        const displayOrder = Cards.sortByRank(PHOTO_HAND);
        const doc = confirmedDoc({ playedCards: ['AS', 'AH', '2C'] });
        const hand = logic.remainingInDisplayOrder(displayOrder, doc);

        expect(hand).toHaveLength(10);
        expect(hand).toEqual(displayOrder.filter((c) => !['AS', 'AH', '2C'].includes(c)));
    });

    test('remainingInDisplayOrder is safe on an unconfirmed doc', () => {
        expect(logic.remainingInDisplayOrder([], capturedDoc())).toEqual([]);
        expect(logic.remainingInDisplayOrder([], null)).toEqual([]);
    });

    test('the photo-order positions the station announces are untouched by arranging', () => {
        // Arranging is cosmetic: position math still runs off `cards`.
        const doc = confirmedDoc({ playedCards: ['7S'] });
        expect(Cards.positionOf('QH', doc.cards, doc.playedCards)).toBe(1);
        expect(Cards.positionOf('2C', doc.cards, doc.playedCards)).toBe(2);
    });
});

describe('fix hand guard (WP7)', () => {
    test('allowed while at least one card is unplayed', () => {
        const doc = confirmedDoc({ playedCards: PHOTO_HAND.slice(0, 12) });
        expect(logic.canFixHand(doc)).toBe(true);

        const { state } = logic.reduce(acceptedState(doc), { type: 'fixHand', doc });
        expect(state.fixing).toBe(true);
        expect(state.entry).toEqual(PHOTO_HAND);   // seeded, editable
        expect(logic.deriveState(doc, state)).toBe(SCREENS.ENTER);
    });

    test('blocked once all 13 are played', () => {
        const doc = confirmedDoc({ playedCards: PHOTO_HAND.slice() });
        expect(logic.canFixHand(doc)).toBe(false);

        const before = acceptedState(doc);
        const { state, effects } = logic.reduce(before, { type: 'fixHand', doc });
        expect(state).toBe(before);
        expect(effects).toEqual([]);
    });

    test('blocked with no confirmed hand at all', () => {
        expect(logic.canFixHand(capturedDoc())).toBe(false);
        expect(logic.canFixHand(null)).toBe(false);
        expect(logic.canFixHand({ cards: [] })).toBe(false);
    });

    test('re-confirming after a fix rewrites cards in the corrected entry order', () => {
        const doc = confirmedDoc({ playedCards: ['7S'] });
        let state = logic.reduce(acceptedState(doc), { type: 'fixHand', doc }).state;

        // Repair a digitise typo: QH was really QD.
        state = logic.reduce(state, { type: 'toggle', card: 'QH', source: 'tray' }).state;
        state = logic.reduce(state, { type: 'toggle', card: 'QD', source: 'grid' }).state;

        const { state: next, effects } = logic.reduce(state, { type: 'confirm' });
        expect(effects[0].type).toBe('confirmHand');
        expect(effects[0].cards).toHaveLength(13);
        expect(effects[0].cards).toContain('QD');
        expect(effects[0].cards).not.toContain('QH');
        expect(next.fixing).toBe(false);
    });

    test('cancelFix returns to the confirmed hand without writing', () => {
        const doc = confirmedDoc();
        const fixing = logic.reduce(acceptedState(doc), { type: 'fixHand', doc }).state;
        const { state, effects } = logic.reduce(fixing, { type: 'cancelFix' });

        expect(state.fixing).toBe(false);
        expect(state.entry).toEqual([]);
        expect(effects).toEqual([]);
        expect(logic.deriveState(doc, state)).toBe(SCREENS.ARRANGE);
    });

    test('cancelFix outside a fix is a no-op', () => {
        const before = logic.initialState();
        expect(logic.reduce(before, { type: 'cancelFix' }).state).toBe(before);
    });
});

describe('round-end / next deal (WP7)', () => {
    test('docs vanishing mid-listen returns to WAITING_CAPTURE, not blank or error', () => {
        const doc = confirmedDoc({ playedCards: PHOTO_HAND.slice(0, 13) });
        const state = acceptedState(doc);
        expect(logic.deriveState(doc, state)).toBe(SCREENS.PLAY);

        // The table submits the round → cleanup deletes the ghost docs.
        expect(logic.deriveState(null, state)).toBe(SCREENS.WAITING_CAPTURE);
        expect(logic.deriveState(undefined, state)).toBe(SCREENS.WAITING_CAPTURE);
    });

    test('a fresh state for the next round index waits for the new hand', () => {
        const next = logic.initialState({ roundIndex: 1 });
        expect(logic.deriveState(null, next)).toBe(SCREENS.WAITING_CAPTURE);
        expect(next.entry).toEqual([]);
        expect(next.displayOrder).toEqual([]);
        expect(next.photoAccepted).toBe(false);
    });

    test('isStaleRound spots local state belonging to the previous deal', () => {
        const state = logic.initialState({ roundIndex: 0 });
        expect(logic.isStaleRound(state, 0)).toBe(false);
        expect(logic.isStaleRound(state, 1)).toBe(true);
    });

    test('a full deal cycles back to WAITING_CAPTURE for the next round', () => {
        // Deal 0: capture → accept → enter → confirm → play out.
        const doc0 = capturedDoc();
        let state = logic.reduce(logic.initialState({ roundIndex: 0 }), {
            type: 'acceptPhoto', doc: doc0,
        }).state;
        state = enterCards(state, PHOTO_HAND);
        expect(logic.reduce(state, { type: 'confirm' }).effects[0].cards).toEqual(PHOTO_HAND);

        // Table submits → docs gone. Ghost rolls into deal 1 with a clean slate.
        expect(logic.deriveState(null, state)).toBe(SCREENS.WAITING_CAPTURE);
        const deal1 = logic.initialState({ roundIndex: 1 });
        expect(logic.deriveState(null, deal1)).toBe(SCREENS.WAITING_CAPTURE);
    });
});

// ─── BLOCKER 2: clearCards is a documented, executable effect ──────────────

describe('BLOCKER 2 — the clearCards effect is documented and executable', () => {
    test('retake-after-confirm emits clearCards alongside requestCapture', () => {
        const doc = confirmedDoc();
        const { effects } = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(effects).toEqual([
            { type: 'requestCapture' },
            { type: 'clearCards' },
        ]);
    });

    test("the reducer's effects table maps clearCards to GhostService.clearHand", () => {
        // The mapping the P3 DOM agent implements must be unambiguous in the
        // source, not folklore. §WP5's AC: "retake resets ENTER progress and
        // clears `cards` via service call".
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostSeatView.js'), 'utf8'
        );
        const table = source.slice(
            source.indexOf('| Effect | Executor |'),
            source.indexOf('Unknown actions and disallowed transitions')
        );
        expect(table).toContain('clearCards');
        expect(table).toContain('clearHand');
        // And every other effect names its executor too.
        for (const [effect, method] of [
            ['requestCapture', 'requestCapture'],
            ['confirmHand', 'confirmHand'],
            ['playCard', 'playCard'],
            ['undoLastCard', 'undoLastCard'],
        ]) {
            expect(table).toContain(effect);
            expect(table).toContain(method);
        }
        // saveDisplayOrder is explicitly NOT a service call.
        expect(table).toMatch(/saveDisplayOrder[\s\S]*localStorage/);
    });

    test('clearHand exists on GhostService and accepts the reducer-side arguments', async () => {
        // Cross-module contract: the effect the reducer emits has an executor.
        // (The full behavioural suite lives in ghost-service-logic.test.js.)
        const GhostService = require('../js/services/ghostService.js');
        expect(typeof GhostService.prototype.clearHand).toBe('function');
        expect(GhostService.prototype.clearHand.length).toBe(3);  // matchId, roundIndex, seatKey
    });

    test('retake mid-play emits nothing — the reducer refuses first', () => {
        // This asserted the opposite until the mid-play guard landed: the
        // reducer used to emit clearCards and let the service reject it. That
        // stranded the ghost — local state reset to PHOTO_REVIEW, where
        // neither "Undo last card" nor "Fix hand" is on screen, so there was
        // no way back to PLAY with the stale hand still confirmed server-side.
        // The reducer now refuses first, keeps the ghost on PLAY, and names
        // the way out via retakeBlockedBy. See ghostSeatView.js § retake.
        const doc = confirmedDoc({ playedCards: ['7S'] });
        const { state, effects } = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(effects).toEqual([]);
        expect(state.warning).toBe(logic.retakeBlockedBy(doc));
        expect(state.warning).toBeTruthy();
    });

    test('retake before any card is played still clears the stale hand', () => {
        // The guard must not over-refuse: with nothing played there is no play
        // history to protect, so the confirmed hand is cleared as before.
        const doc = confirmedDoc({ playedCards: [] });
        const { effects } = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(effects.map((e) => e.type)).toEqual(['requestCapture', 'clearCards']);
    });

    test('retake with no confirmed hand emits no clearCards — nothing to clear', () => {
        const doc = capturedDoc();
        const { effects } = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(effects).toEqual([{ type: 'requestCapture' }]);
    });

    test('after a retake the local state cannot re-confirm the stale hand', () => {
        const doc = confirmedDoc();
        const { state } = logic.reduce(acceptedState(doc), { type: 'retake', doc });
        expect(state.entry).toEqual([]);
        expect(logic.canConfirm(state)).toBe(false);
        expect(logic.reduce(state, { type: 'confirm' }).effects).toEqual([]);
    });
});

// ─── MINOR 7: late-bound Cards ─────────────────────────────────────────────

describe('MINOR 7 — Cards is resolved lazily, never bound eagerly to null', () => {
    test('the module late-binds via globalThis rather than capturing a const', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostSeatView.js'), 'utf8'
        );
        expect(source).toContain('globalThis.Cards');
        expect(source).not.toMatch(/^\s*const C = \(typeof Cards/m);
    });

    test('a missing Cards throws loudly instead of silently no-opping every guard', () => {
        const saved = globalThis.Cards;
        try {
            delete globalThis.Cards;
            // The failure mode: guards written as `if (!C) …` would silently
            // reject every tap, skip validation, and refuse every play.
            expect(() => logic.reduce(logic.initialState(), {
                type: 'toggle', card: 'AS', source: 'grid',
            })).toThrow(/cards\.js/);
            expect(() => logic.canConfirm({ entry: PHOTO_HAND })).toThrow(/cards\.js/);
            expect(() => logic.applySort(PHOTO_HAND, 'suit')).toThrow(/cards\.js/);
        } finally {
            globalThis.Cards = saved;
        }
    });

    test('a Cards that arrives after this module loaded is picked up', () => {
        const saved = globalThis.Cards;
        try {
            delete globalThis.Cards;
            expect(() => logic.canConfirm({ entry: PHOTO_HAND })).toThrow();
            globalThis.Cards = saved;                       // late script order
            expect(logic.canConfirm({ entry: PHOTO_HAND })).toBe(true);
        } finally {
            globalThis.Cards = saved;
        }
    });
});

// ─── API contracts the P3 DOM agent must honour ────────────────────────────

describe('CONTRACT — silent no-ops the DOM layer must not trip over', () => {
    test('toggle without source:"tray" cannot remove — documented as a no-op', () => {
        const before = enterCards(logic.initialState(), ['QH', '7S']);
        for (const action of [
            { type: 'toggle', card: 'QH' },                       // no source at all
            { type: 'toggle', card: 'QH', source: 'grid' },
            { type: 'toggle', card: 'QH', source: 'anything' },
        ]) {
            const { state, effects } = logic.reduce(before, action);
            expect(state).toBe(before);           // identical object: pure no-op
            expect(effects).toEqual([]);
        }
        // Only the tray removes.
        expect(logic.reduce(before, { type: 'toggle', card: 'QH', source: 'tray' }).state.entry)
            .toEqual(['7S']);
    });

    test('the toggle source contract is spelled out in the source', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostSeatView.js'), 'utf8'
        );
        expect(source).toMatch(/CONTRACT FOR THE DOM LAYER[\s\S]{0,400}source:'tray'/);
    });

    test('every doc-dependent action silently no-ops without action.doc', () => {
        const state = {
            ...logic.initialState(),
            entry: PHOTO_HAND.slice(),
            displayOrder: PHOTO_HAND.slice(),
            photoAccepted: true,
            acceptedSeq: 1,
        };
        for (const type of [
            'acceptPhoto', 'sort', 'reorder', 'play', 'undoLastCard', 'fixHand',
        ]) {
            const { state: next, effects } = logic.reduce(state, {
                type, card: 'QH', mode: 'suit', fromIndex: 0, toIndex: 1,
            });
            expect(next).toBe(state);
            expect(effects).toEqual([]);
        }
    });

    test('retake without a doc still fires the shutter but cannot know to clear', () => {
        // Documented asymmetry: `retake` degrades rather than no-ops, because
        // re-requesting a photo is always safe. It just cannot see a confirmed
        // hand, so the DOM must pass the doc for clearCards to be emitted.
        const { effects } = logic.reduce(logic.initialState(), { type: 'retake' });
        expect(effects).toEqual([{ type: 'requestCapture' }]);
    });

    test('the action.doc requirement is spelled out in the source', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostSeatView.js'), 'utf8'
        );
        const warning = source.slice(
            source.indexOf('`action.doc` is required'),
            source.indexOf('@param {Object} state Local state')
        );
        for (const type of [
            'acceptPhoto', 'retake', 'sort', 'reorder', 'play', 'undoLastCard', 'fixHand',
        ]) {
            expect(warning).toContain(type);
        }
    });
});

describe('reducer purity', () => {
    /** Deep-freeze so any mutation attempt throws in strict mode. */
    function deepFreeze(obj) {
        Object.getOwnPropertyNames(obj).forEach((k) => {
            const v = obj[k];
            if (v && typeof v === 'object') deepFreeze(v);
        });
        return Object.freeze(obj);
    }

    const doc = confirmedDoc({ playedCards: ['7S'] });

    const ACTIONS = [
        { type: 'requestCapture' },
        { type: 'acceptPhoto', doc },
        { type: 'retake', doc },
        { type: 'toggle', card: 'QD', source: 'grid' },
        { type: 'toggle', card: '7S', source: 'tray' },
        { type: 'undoLast' },
        { type: 'confirm' },
        { type: 'confirm', otherSeats: [{ memberName: 'Priya', cards: ['QH'] }] },
        { type: 'sort', mode: 'suit', doc },
        { type: 'sort', mode: 'rank', doc },
        { type: 'reorder', fromIndex: 0, toIndex: 4, doc },
        { type: 'play', card: 'QH', doc },
        { type: 'undoLastCard', doc },
        { type: 'fixHand', doc },
        { type: 'cancelFix' },
        { type: 'dismissWarning' },
        { type: 'nonsense-unknown-action' },
        {},
    ];

    test.each(ACTIONS.map((a) => [a.type || '(no type)', a]))(
        'action %s does not mutate the input state',
        (_name, action) => {
            const state = {
                ...logic.initialState({ roundIndex: 0 }),
                entry: PHOTO_HAND.slice(),
                displayOrder: PHOTO_HAND.slice(),
                fixing: true,
                warning: 'existing',
            };
            const snapshot = JSON.parse(JSON.stringify(state));
            deepFreeze(state);

            expect(() => logic.reduce(state, action)).not.toThrow();
            expect(state).toEqual(snapshot);
            expect(state.entry).toEqual(PHOTO_HAND);
            expect(state.displayOrder).toEqual(PHOTO_HAND);
        }
    );

    test('the returned state is never the same object when something changed', () => {
        const state = logic.initialState();
        const next = logic.reduce(state, { type: 'toggle', card: 'AS', source: 'grid' }).state;
        expect(next).not.toBe(state);
        expect(state.entry).toEqual([]);
    });

    test('an unknown action returns the identical state object and no effects', () => {
        const state = logic.initialState();
        const out = logic.reduce(state, { type: 'no-such-action' });
        expect(out.state).toBe(state);
        expect(out.effects).toEqual([]);
    });

    test('reduce tolerates missing state and action', () => {
        expect(() => logic.reduce()).not.toThrow();
        expect(() => logic.reduce(null, null)).not.toThrow();
        expect(logic.reduce(null, null).effects).toEqual([]);
    });

    test('initialState returns independent copies, not shared references', () => {
        const a = logic.initialState();
        const b = logic.initialState();
        a.entry.push('AS');
        expect(b.entry).toEqual([]);

        const seed = ['AS', 'KH'];
        const c = logic.initialState({ entry: seed });
        c.entry.push('QD');
        expect(seed).toEqual(['AS', 'KH']);
    });

    test('effects are always an array', () => {
        for (const action of ACTIONS) {
            expect(Array.isArray(logic.reduce(logic.initialState(), action).effects)).toBe(true);
        }
    });
});

describe('scope: the module carries no score-bearing state', () => {
    test('the reducer exposes no field or effect naming a declaration or a bid', () => {
        // The whole feature is card delivery only: those are voice calls typed
        // at the table. Guarded here as well as by the grep in the WP's AC.
        const forbidden = /bl1nd|prom1se/i;   // spelled around the literal grep
        const keys = Object.keys(logic.initialState());
        for (const k of keys) expect(k).not.toMatch(forbidden);

        const source = require('fs').readFileSync(
            require('path').join(__dirname, '../js/components/ghostSeatView.js'), 'utf8'
        );
        // The literal AC: no occurrence, case-insensitive, anywhere in the file.
        expect(source).not.toMatch(/bl[i]nd/i);
        expect(source).not.toMatch(/prom[i]se/i);
    });

    test('no effect type reaches the round form', () => {
        const seen = new Set();
        const doc = confirmedDoc();
        for (const action of [
            { type: 'requestCapture' },
            { type: 'retake', doc },
            { type: 'play', card: 'QH', doc },
            { type: 'undoLastCard', doc: confirmedDoc({ playedCards: ['QH'] }) },
            { type: 'sort', mode: 'suit', doc },
        ]) {
            for (const e of logic.reduce(acceptedState(doc), action).effects) seen.add(e.type);
        }
        const confirmEffects = logic.reduce(
            enterCards(logic.initialState(), PHOTO_HAND), { type: 'confirm' }
        ).effects;
        for (const e of confirmEffects) seen.add(e.type);

        expect([...seen].sort()).toEqual([
            'clearCards', 'confirmHand', 'playCard', 'requestCapture',
            'saveDisplayOrder', 'undoLastCard',
        ]);
    });
});
