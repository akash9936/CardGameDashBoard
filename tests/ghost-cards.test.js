const Cards = require('../js/utils/cards.js');

// A realistic 13-card hand in "photo order" (left → right as fanned for the
// camera). Deliberately unsorted — photo order is whatever the deal produced.
const PHOTO_HAND = [
    '7S', 'QH', '2C', 'AS', '9H', 'JD', 'KC', '4H', '8D', 'AH', '3C', 'TS', '5D',
];

describe('Cards constants', () => {
    test('SUITS and RANKS are in canonical order', () => {
        expect(Cards.SUITS).toEqual(['S', 'H', 'D', 'C']);
        expect(Cards.RANKS).toEqual(
            ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
        );
    });

    test('DECK is exactly 52 codes', () => {
        expect(Cards.DECK).toHaveLength(52);
    });

    test('DECK has no duplicates', () => {
        expect(new Set(Cards.DECK).size).toBe(52);
    });

    test('every DECK entry is a valid code', () => {
        for (const code of Cards.DECK) {
            expect(Cards.isValidCode(code)).toBe(true);
        }
    });

    test('DECK covers every suit × rank combination', () => {
        const expected = [];
        for (const s of Cards.SUITS) for (const r of Cards.RANKS) expected.push(r + s);
        expect(Cards.DECK).toEqual(expected);
    });

    test('CODE_CHARSET is 31 look-alike-free characters', () => {
        expect(Cards.CODE_CHARSET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
        expect(Cards.CODE_CHARSET).toHaveLength(31);
        for (const bad of ['I', 'L', 'O', '0', '1']) {
            expect(Cards.CODE_CHARSET).not.toContain(bad);
        }
    });
});

describe('Cards.isValidCode', () => {
    test('accepts well-formed codes', () => {
        expect(Cards.isValidCode('AS')).toBe(true);
        expect(Cards.isValidCode('TH')).toBe(true);
        expect(Cards.isValidCode('2C')).toBe(true);
        expect(Cards.isValidCode('KD')).toBe(true);
    });

    test('rejects lowercase — the model is strict by design', () => {
        expect(Cards.isValidCode('as')).toBe(false);
        expect(Cards.isValidCode('aS')).toBe(false);
        expect(Cards.isValidCode('As')).toBe(false);
        expect(Cards.isValidCode('th')).toBe(false);
    });

    test('rejects wrong length', () => {
        expect(Cards.isValidCode('')).toBe(false);
        expect(Cards.isValidCode('A')).toBe(false);
        expect(Cards.isValidCode('10S')).toBe(false);
        expect(Cards.isValidCode('ASX')).toBe(false);
    });

    test('rejects bad ranks and bad suits', () => {
        expect(Cards.isValidCode('1S')).toBe(false);   // Ace is A, there is no 1
        expect(Cards.isValidCode('XS')).toBe(false);
        expect(Cards.isValidCode('AX')).toBe(false);
        expect(Cards.isValidCode('SA')).toBe(false);   // transposed
    });

    test('rejects non-strings', () => {
        expect(Cards.isValidCode(null)).toBe(false);
        expect(Cards.isValidCode(undefined)).toBe(false);
        expect(Cards.isValidCode(12)).toBe(false);
        expect(Cards.isValidCode(['A', 'S'])).toBe(false);
        expect(Cards.isValidCode({ rank: 'A', suit: 'S' })).toBe(false);
    });

    test('rejects prototype-ish strings that must not resolve via lookup', () => {
        expect(Cards.isValidCode('__')).toBe(false);
        expect(Cards.isValidCode('cS')).toBe(false);
    });
});

describe('Cards.suitOf / Cards.rankOf', () => {
    test('extract the characters', () => {
        expect(Cards.suitOf('AS')).toBe('S');
        expect(Cards.suitOf('TH')).toBe('H');
        expect(Cards.rankOf('AS')).toBe('A');
        expect(Cards.rankOf('TH')).toBe('T');   // raw rank, not the display form
        expect(Cards.rankOf('2C')).toBe('2');
    });

    test('null for invalid input', () => {
        expect(Cards.suitOf('as')).toBeNull();
        expect(Cards.suitOf('ZZ')).toBeNull();
        expect(Cards.suitOf(null)).toBeNull();
        expect(Cards.rankOf('as')).toBeNull();
        expect(Cards.rankOf(undefined)).toBeNull();
        expect(Cards.rankOf(7)).toBeNull();
    });
});

describe('Cards.display', () => {
    test('ten renders as 10, never T', () => {
        expect(Cards.display('TH')).toEqual({ rank: '10', suit: '♥', color: 'red' });
        expect(Cards.display('TS')).toEqual({ rank: '10', suit: '♠', color: 'black' });
    });

    test('black suits', () => {
        expect(Cards.display('AS')).toEqual({ rank: 'A', suit: '♠', color: 'black' });
        expect(Cards.display('KC')).toEqual({ rank: 'K', suit: '♣', color: 'black' });
    });

    test('red suits', () => {
        expect(Cards.display('QH')).toEqual({ rank: 'Q', suit: '♥', color: 'red' });
        expect(Cards.display('2D')).toEqual({ rank: '2', suit: '♦', color: 'red' });
    });

    test('non-ten ranks pass through unchanged', () => {
        for (const rank of Cards.RANKS) {
            const expected = rank === 'T' ? '10' : rank;
            expect(Cards.display(rank + 'S').rank).toBe(expected);
        }
    });

    test('null for invalid input', () => {
        expect(Cards.display('as')).toBeNull();
        expect(Cards.display('10S')).toBeNull();
        expect(Cards.display(null)).toBeNull();
        expect(Cards.display(42)).toBeNull();
    });

    test('every deck card renders', () => {
        for (const code of Cards.DECK) {
            const d = Cards.display(code);
            expect(d).not.toBeNull();
            expect(['red', 'black']).toContain(d.color);
            expect('♠♥♦♣').toContain(d.suit);
        }
    });
});

describe('Cards.validateHand', () => {
    test('accepts a good 13-card hand', () => {
        expect(Cards.validateHand(PHOTO_HAND)).toEqual({ ok: true, errors: [] });
    });

    test('rejects 12 cards', () => {
        const result = Cards.validateHand(PHOTO_HAND.slice(0, 12));
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('exactly 13');
        expect(result.errors[0]).toContain('12');
    });

    test('rejects 14 cards', () => {
        const result = Cards.validateHand(PHOTO_HAND.concat(['6S']));
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('14');
    });

    test('rejects duplicates and names the offending card', () => {
        const hand = PHOTO_HAND.slice(0, 12).concat(['7S']);   // 7S already first
        const result = Cards.validateHand(hand);
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('Duplicate');
        expect(result.errors[0]).toContain('7♠');
    });

    test('rejects an invalid code and names it', () => {
        const hand = PHOTO_HAND.slice(0, 12).concat(['ZZ']);
        const result = Cards.validateHand(hand);
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('valid card code');
        expect(result.errors[0]).toContain('"ZZ"');
    });

    test('rejects lowercase entries as invalid codes', () => {
        const hand = PHOTO_HAND.slice(0, 12).concat(['ks']);
        const result = Cards.validateHand(hand);
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('"ks"');
    });

    test('rejects non-arrays with a single clear error', () => {
        for (const bad of [null, undefined, 'ASKS', 13, {}, new Set(PHOTO_HAND)]) {
            const result = Cards.validateHand(bad);
            expect(result.ok).toBe(false);
            expect(result.errors).toEqual(['Hand must be an array of 13 card codes.']);
        }
    });

    test('rejects an empty hand', () => {
        const result = Cards.validateHand([]);
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('got 0');
    });

    test('accumulates multiple independent errors', () => {
        // 14 entries, containing a duplicate AND an invalid code.
        const hand = PHOTO_HAND.slice(0, 12).concat(['7S', 'ZZ']);
        const result = Cards.validateHand(hand);
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(3);
        expect(result.errors.join(' ')).toContain('exactly 13');
        expect(result.errors.join(' ')).toContain('valid card code');
        expect(result.errors.join(' ')).toContain('Duplicate');
    });

    test('reports each distinct duplicate once', () => {
        const hand = ['AS', 'AS', 'AS', 'KH', 'KH', '2C', '3C', '4C',
            '5C', '6C', '7C', '8C', '9C'];
        const result = Cards.validateHand(hand);
        expect(result.ok).toBe(false);
        const dupeError = result.errors.find((e) => e.startsWith('Duplicate'));
        expect(dupeError).toBe('Duplicate card: A♠, K♥.');
    });
});

describe('Cards.sortBySuit', () => {
    test('groups by SUITS order, rank-descending within a suit', () => {
        expect(Cards.sortBySuit(PHOTO_HAND)).toEqual([
            'AS', 'TS', '7S',          // ♠
            'AH', 'QH', '9H', '4H',    // ♥
            'JD', '8D', '5D',          // ♦
            'KC', '3C', '2C',          // ♣
        ]);
    });

    test('does not mutate the input', () => {
        const input = PHOTO_HAND.slice();
        const snapshot = input.slice();
        Cards.sortBySuit(input);
        expect(input).toEqual(snapshot);
    });

    test('returns a new array, not the same reference', () => {
        const input = PHOTO_HAND.slice();
        expect(Cards.sortBySuit(input)).not.toBe(input);
    });

    test('sorting the whole deck is a fixed point', () => {
        expect(Cards.sortBySuit(Cards.DECK)).toEqual(Cards.DECK);
    });

    test('drops invalid entries and tolerates non-arrays', () => {
        expect(Cards.sortBySuit(['QH', 'zz', 'AS', null])).toEqual(['AS', 'QH']);
        expect(Cards.sortBySuit(null)).toEqual([]);
        expect(Cards.sortBySuit(undefined)).toEqual([]);
        expect(Cards.sortBySuit([])).toEqual([]);
    });
});

describe('Cards.sortByRank', () => {
    test('rank first, suit as tiebreak', () => {
        expect(Cards.sortByRank(PHOTO_HAND)).toEqual([
            'AS', 'AH', 'KC', 'QH', 'JD', 'TS', '9H', '8D', '7S', '5D', '4H', '3C', '2C',
        ]);
    });

    test('same rank across all four suits orders S H D C', () => {
        expect(Cards.sortByRank(['AC', 'AD', 'AH', 'AS']))
            .toEqual(['AS', 'AH', 'AD', 'AC']);
    });

    test('does not mutate the input', () => {
        const input = PHOTO_HAND.slice();
        const snapshot = input.slice();
        Cards.sortByRank(input);
        expect(input).toEqual(snapshot);
    });

    test('returns a new array, not the same reference', () => {
        const input = PHOTO_HAND.slice();
        expect(Cards.sortByRank(input)).not.toBe(input);
    });

    test('drops invalid entries and tolerates non-arrays', () => {
        expect(Cards.sortByRank(['2C', 'nope', 'AS'])).toEqual(['AS', '2C']);
        expect(Cards.sortByRank(null)).toEqual([]);
        expect(Cards.sortByRank([])).toEqual([]);
    });

    test('the two sorts are permutations of each other', () => {
        expect(Cards.sortBySuit(PHOTO_HAND).slice().sort())
            .toEqual(Cards.sortByRank(PHOTO_HAND).slice().sort());
    });
});

describe('Cards.remainingHand', () => {
    test('nothing played → the whole hand, photo order intact', () => {
        expect(Cards.remainingHand(PHOTO_HAND, [])).toEqual(PHOTO_HAND);
    });

    test('preserves photo order after non-contiguous removals', () => {
        // Remove the 2nd, 5th, 8th and 13th cards of the fan.
        const played = ['QH', '9H', '4H', '5D'];
        expect(Cards.remainingHand(PHOTO_HAND, played)).toEqual([
            '7S', '2C', 'AS', 'JD', 'KC', '8D', 'AH', '3C', 'TS',
        ]);
    });

    test('play order does not affect the result — only membership does', () => {
        const a = Cards.remainingHand(PHOTO_HAND, ['5D', 'QH', '4H', '9H']);
        const b = Cards.remainingHand(PHOTO_HAND, ['QH', '9H', '4H', '5D']);
        expect(a).toEqual(b);
    });

    test('a played card not in the hand is ignored gracefully', () => {
        expect(Cards.remainingHand(PHOTO_HAND, ['6S'])).toEqual(PHOTO_HAND);
        expect(Cards.remainingHand(PHOTO_HAND, ['QH', '6S', 'zz']))
            .toEqual(PHOTO_HAND.filter((c) => c !== 'QH'));
    });

    test('a duplicated played entry removes only the copies actually held', () => {
        expect(Cards.remainingHand(PHOTO_HAND, ['QH', 'QH']))
            .toEqual(PHOTO_HAND.filter((c) => c !== 'QH'));
    });

    test('all 13 played → empty', () => {
        expect(Cards.remainingHand(PHOTO_HAND, PHOTO_HAND.slice())).toEqual([]);
    });

    test('null / undefined hand → []', () => {
        expect(Cards.remainingHand(null, ['QH'])).toEqual([]);
        expect(Cards.remainingHand(undefined, [])).toEqual([]);
        expect(Cards.remainingHand('AS', [])).toEqual([]);
    });

    test('null / undefined played is treated as []', () => {
        expect(Cards.remainingHand(PHOTO_HAND, null)).toEqual(PHOTO_HAND);
        expect(Cards.remainingHand(PHOTO_HAND, undefined)).toEqual(PHOTO_HAND);
    });

    test('does not mutate either input', () => {
        const hand = PHOTO_HAND.slice();
        const played = ['QH', '9H'];
        const handSnapshot = hand.slice();
        const playedSnapshot = played.slice();
        Cards.remainingHand(hand, played);
        expect(hand).toEqual(handSnapshot);
        expect(played).toEqual(playedSnapshot);
    });
});

describe('Cards.positionOf', () => {
    test('the worked example from the plan', () => {
        const photo = ['AS', 'KH', 'QS', '2C', '9D'];
        expect(Cards.positionOf('QS', photo, ['KH'])).toBe(2);
    });

    test('positions are 1-based with nothing played', () => {
        expect(Cards.positionOf('7S', PHOTO_HAND, [])).toBe(1);
        expect(Cards.positionOf('QH', PHOTO_HAND, [])).toBe(2);
        expect(Cards.positionOf('5D', PHOTO_HAND, [])).toBe(13);
    });

    test('null for an already-played card', () => {
        expect(Cards.positionOf('QH', PHOTO_HAND, ['QH'])).toBeNull();
    });

    test('null for a card never held', () => {
        expect(Cards.positionOf('6S', PHOTO_HAND, [])).toBeNull();
        expect(Cards.positionOf('qh', PHOTO_HAND, [])).toBeNull();
        expect(Cards.positionOf(null, PHOTO_HAND, [])).toBeNull();
    });

    test('null when the hand itself is missing', () => {
        expect(Cards.positionOf('QH', null, [])).toBeNull();
    });

    test('every remaining card reports a position matching remainingHand', () => {
        const played = ['QH', '9H', 'KC'];
        const remaining = Cards.remainingHand(PHOTO_HAND, played);
        remaining.forEach((card, i) => {
            expect(Cards.positionOf(card, PHOTO_HAND, played)).toBe(i + 1);
        });
    });

    test('full simulated 13-trick round, played out of order, with an undo', () => {
        // The ghost plays in a non-sequential order; after every trick the
        // station recomputes "Nth from the left" for the cards still held.
        const played = [];
        const play = (card) => { played.push(card); };
        const undo = () => played.pop();

        // Trick 1 — play the 4th card of the fan (AS).
        expect(Cards.positionOf('AS', PHOTO_HAND, played)).toBe(4);
        play('AS');
        // Everything to its right shifts down one.
        expect(Cards.positionOf('7S', PHOTO_HAND, played)).toBe(1);
        expect(Cards.positionOf('9H', PHOTO_HAND, played)).toBe(4);
        expect(Cards.positionOf('5D', PHOTO_HAND, played)).toBe(12);
        expect(Cards.positionOf('AS', PHOTO_HAND, played)).toBeNull();

        // Trick 2 — the last card of the fan.
        expect(Cards.positionOf('5D', PHOTO_HAND, played)).toBe(12);
        play('5D');
        expect(Cards.remainingHand(PHOTO_HAND, played)).toHaveLength(11);

        // Trick 3 — the first card of the fan.
        expect(Cards.positionOf('7S', PHOTO_HAND, played)).toBe(1);
        play('7S');
        expect(Cards.positionOf('QH', PHOTO_HAND, played)).toBe(1);

        // Trick 4 — a middle card, then a MIS-TAP AND UNDO partway through.
        expect(Cards.positionOf('KC', PHOTO_HAND, played)).toBe(5);
        play('KC');
        expect(Cards.positionOf('4H', PHOTO_HAND, played)).toBe(5);

        // Oops — KC was the wrong card. Undo: the station announces where the
        // handler slides it back to, then it comes out of playedCards.
        expect(Cards.reinsertPosition('KC', PHOTO_HAND, played)).toBe(5);
        expect(undo()).toBe('KC');
        expect(Cards.positionOf('KC', PHOTO_HAND, played)).toBe(5);
        expect(Cards.positionOf('4H', PHOTO_HAND, played)).toBe(6);
        expect(Cards.remainingHand(PHOTO_HAND, played)).toEqual([
            'QH', '2C', '9H', 'JD', 'KC', '4H', '8D', 'AH', '3C', 'TS',
        ]);

        // Re-play the intended card (JD), then continue the round.
        expect(Cards.positionOf('JD', PHOTO_HAND, played)).toBe(4);
        play('JD');
        expect(Cards.positionOf('KC', PHOTO_HAND, played)).toBe(4);

        // Tricks 5-13 — drain the hand, asserting a still-held card each time.
        const rest = ['AH', 'QH', 'TS', '2C', 'KC', '3C', '9H', '8D', '4H'];
        const expectedAfter = [
            // after playing …          a still-held card and its position
            ['3C', 7],   // AH gone
            ['2C', 1],   // QH gone
            ['9H', 2],   // TS gone
            ['9H', 1],   // 2C gone
            ['4H', 2],   // KC gone
            ['8D', 3],   // 3C gone
            ['8D', 2],   // 9H gone
            ['4H', 1],   // 8D gone
            [null, null],// 4H gone — hand empty
        ];
        rest.forEach((card, i) => {
            // The card being played is always still held right before the tap.
            expect(Cards.positionOf(card, PHOTO_HAND, played)).not.toBeNull();
            play(card);
            const [probe, pos] = expectedAfter[i];
            if (probe === null) {
                expect(Cards.remainingHand(PHOTO_HAND, played)).toEqual([]);
            } else {
                expect(Cards.positionOf(probe, PHOTO_HAND, played)).toBe(pos);
            }
        });

        // All 13 played exactly once, hand empty, no card left addressable.
        expect(played).toHaveLength(13);
        expect(new Set(played).size).toBe(13);
        expect(new Set(played)).toEqual(new Set(PHOTO_HAND));
        expect(Cards.remainingHand(PHOTO_HAND, played)).toEqual([]);
        for (const card of PHOTO_HAND) {
            expect(Cards.positionOf(card, PHOTO_HAND, played)).toBeNull();
        }
    });
});

describe('Cards.reinsertPosition', () => {
    test('first-position reinsert — the leftmost card of the fan comes back', () => {
        // 7S is photo position 1; whatever else is gone, it returns to the front.
        expect(Cards.reinsertPosition('7S', PHOTO_HAND, ['QH', '9H', '7S'])).toBe(1);
    });

    test('middle reinsert', () => {
        // Photo order minus QH and 9H, with JD restored:
        // 7S 2C AS JD KC …  → JD is 4th.
        expect(Cards.reinsertPosition('JD', PHOTO_HAND, ['QH', '9H', 'JD'])).toBe(4);
    });

    test('last-position reinsert — the rightmost card of the fan comes back', () => {
        // 5D is photo position 13; with two earlier cards gone it returns 11th.
        expect(Cards.reinsertPosition('5D', PHOTO_HAND, ['QH', '9H', '5D'])).toBe(11);
        // With nothing else played it returns to the very end.
        expect(Cards.reinsertPosition('5D', PHOTO_HAND, ['5D'])).toBe(13);
    });

    test('the plan example: undoing a non-final entry still resolves', () => {
        const photo = ['AS', 'KH', 'QS', '2C', '9D'];
        // played [QS, KH]; take KH back → packet becomes AS KH 2C 9D → 2.
        expect(Cards.reinsertPosition('KH', photo, ['QS', 'KH'])).toBe(2);
    });

    test('equals positionOf against the already-popped played list', () => {
        const before = ['QH', '9H', 'JD'];
        const after = before.slice(0, -1);
        expect(Cards.reinsertPosition('JD', PHOTO_HAND, before))
            .toBe(Cards.positionOf('JD', PHOTO_HAND, after));
    });

    test('idempotent when the caller already popped the entry', () => {
        expect(Cards.reinsertPosition('JD', PHOTO_HAND, ['QH', '9H']))
            .toBe(Cards.reinsertPosition('JD', PHOTO_HAND, ['QH', '9H', 'JD']));
    });

    test('undoing the only played card restores its original position', () => {
        PHOTO_HAND.forEach((card, i) => {
            expect(Cards.reinsertPosition(card, PHOTO_HAND, [card])).toBe(i + 1);
        });
    });

    test('null when the card is not in the hand at all', () => {
        expect(Cards.reinsertPosition('6S', PHOTO_HAND, ['6S'])).toBeNull();
        expect(Cards.reinsertPosition('6S', PHOTO_HAND, [])).toBeNull();
        expect(Cards.reinsertPosition('KC', null, ['KC'])).toBeNull();
    });

    test('does not mutate playedCards', () => {
        const played = ['QH', '9H', 'JD'];
        const snapshot = played.slice();
        Cards.reinsertPosition('JD', PHOTO_HAND, played);
        expect(played).toEqual(snapshot);
    });

    test('tolerates a null played list', () => {
        expect(Cards.reinsertPosition('7S', PHOTO_HAND, null)).toBe(1);
    });
});

describe('Cards.generateAccessCode', () => {
    test('deterministic for fixed bytes', () => {
        const bytes = [0, 1, 2, 30, 31, 255];
        // 0→A, 1→B, 2→C, 30→9, 31→A (wraps), 255 % 31 = 7 → H
        expect(Cards.generateAccessCode(bytes)).toBe('ABC9AH');
        expect(Cards.generateAccessCode(bytes)).toBe('ABC9AH');
    });

    test('works with a Uint8Array', () => {
        const bytes = Uint8Array.from([0, 1, 2, 30, 31, 255]);
        expect(Cards.generateAccessCode(bytes)).toBe('ABC9AH');
        expect(Cards.generateAccessCode(bytes))
            .toBe(Cards.generateAccessCode([0, 1, 2, 30, 31, 255]));
    });

    test('always 6 characters, all inside the charset', () => {
        for (let seed = 0; seed < 64; seed++) {
            const bytes = [0, 1, 2, 3, 4, 5].map((i) => (seed * 37 + i * 53) % 256);
            const code = Cards.generateAccessCode(bytes);
            expect(code).toHaveLength(Cards.CODE_LENGTH);
            for (const ch of code) expect(Cards.CODE_CHARSET).toContain(ch);
            expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
        }
    });

    test('never emits a look-alike character', () => {
        for (let b = 0; b < 256; b++) {
            const code = Cards.generateAccessCode([b, b, b, b, b, b]);
            expect(code).not.toMatch(/[ILO01]/);
        }
    });

    test('different bytes generally give different codes', () => {
        expect(Cards.generateAccessCode([0, 0, 0, 0, 0, 0])).toBe('AAAAAA');
        expect(Cards.generateAccessCode([1, 1, 1, 1, 1, 1])).toBe('BBBBBB');
    });

    test('throws on wrong-length input', () => {
        expect(() => Cards.generateAccessCode([1, 2, 3])).toThrow(/exactly 6/);
        expect(() => Cards.generateAccessCode([1, 2, 3, 4, 5, 6, 7])).toThrow(/exactly 6/);
        expect(() => Cards.generateAccessCode([])).toThrow(/exactly 6/);
        expect(() => Cards.generateAccessCode(new Uint8Array(5))).toThrow(/exactly 6/);
    });

    test('throws on non-array-like input', () => {
        expect(() => Cards.generateAccessCode(null)).toThrow(/array-like/);
        expect(() => Cards.generateAccessCode(undefined)).toThrow(/array-like/);
        expect(() => Cards.generateAccessCode(123456)).toThrow(/array-like/);
        expect(() => Cards.generateAccessCode('ABCDEF')).toThrow(/array-like/);
    });

    test('does not mutate the byte array', () => {
        const bytes = Uint8Array.from([9, 8, 7, 6, 5, 4]);
        Cards.generateAccessCode(bytes);
        expect(Array.from(bytes)).toEqual([9, 8, 7, 6, 5, 4]);
    });
});

describe('Cards.parseQuery', () => {
    test('the ghost link case', () => {
        expect(Cards.parseQuery('?ghost=X&seat=Y')).toEqual({ ghost: 'X', seat: 'Y' });
        expect(Cards.parseQuery('?ghost=abc123&seat=team1_0'))
            .toEqual({ ghost: 'abc123', seat: 'team1_0' });
    });

    test('empty / non-string input → {}', () => {
        expect(Cards.parseQuery('')).toEqual({});
        expect(Cards.parseQuery('?')).toEqual({});
        expect(Cards.parseQuery(null)).toEqual({});
        expect(Cards.parseQuery(undefined)).toEqual({});
        expect(Cards.parseQuery(42)).toEqual({});
    });

    test('leading "?" is optional', () => {
        expect(Cards.parseQuery('ghost=X&seat=Y')).toEqual({ ghost: 'X', seat: 'Y' });
    });

    test('no-value keys yield empty strings', () => {
        expect(Cards.parseQuery('?ghost&seat=Y')).toEqual({ ghost: '', seat: 'Y' });
        expect(Cards.parseQuery('?ghost=&seat=')).toEqual({ ghost: '', seat: '' });
    });

    test('decodes URL-encoded keys and values', () => {
        expect(Cards.parseQuery('?seat=team%20one_0')).toEqual({ seat: 'team one_0' });
        expect(Cards.parseQuery('?name=A%26B')).toEqual({ name: 'A&B' });
        expect(Cards.parseQuery('?a%20b=c')).toEqual({ 'a b': 'c' });
    });

    test('skips empty segments from "&&"', () => {
        expect(Cards.parseQuery('?ghost=X&&seat=Y')).toEqual({ ghost: 'X', seat: 'Y' });
    });

    test('later duplicate keys win', () => {
        expect(Cards.parseQuery('?seat=A&seat=B')).toEqual({ seat: 'B' });
    });

    test('matches the spectatorPass implementation it was copied from', () => {
        const SpectatorPass = require('../js/components/spectatorPass.js');
        for (const s of ['?tv=1', '?ghost=X&seat=Y', '', '?a&b=1', '?x=%20y', '?a=1&&b=2']) {
            expect(Cards.parseQuery(s)).toEqual(SpectatorPass.logic.parseQuery(s));
        }
    });
});

describe('module hygiene', () => {
    test('exports only the documented API surface', () => {
        expect(Object.keys(Cards).sort()).toEqual([
            'CODE_CHARSET', 'CODE_LENGTH', 'DECK', 'RANKS', 'SUITS',
            'SUIT_COLORS', 'SUIT_SYMBOLS',
            'display', 'generateAccessCode', 'isValidCode', 'parseQuery',
            'positionOf', 'rankOf', 'reinsertPosition', 'remainingHand',
            'sortByRank', 'sortBySuit', 'suitOf', 'validateHand',
        ].sort());
    });

    test('every exported function is pure enough to run without a DOM', () => {
        // Jest runs in the node environment — no window/document exist here.
        expect(typeof window).toBe('undefined');
        expect(typeof document).toBe('undefined');
        expect(Cards.DECK).toHaveLength(52);
    });
});
