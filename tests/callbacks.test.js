/**
 * Per-match callbacks (commentary-style.md §10.1) — "teesra blind. Teesra."
 *
 * The contract under test: callbacks are COUNTED IN JS from match.rounds and
 * only *stated* by the model. The log says what was already said, so the same
 * observation is never made twice.
 */
const CommentaryLog = require('../js/utils/commentaryLog.js');
global.CommentaryLog = CommentaryLog;
const Callbacks = require('../js/utils/callbacks.js');

function fakeStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

const MATCH_ID = 'cb-1';
const side = (promise, actual, score, blind = false) => ({ promise, actual, score, blind });

function match(rounds) {
    return { id: MATCH_ID, team1Id: 't1', team2Id: 't2', rounds };
}

// A blind round for team1, a plain one for team2.
const blindRound = (hit = true) => ({
    team1: side(7, hit ? 9 : 4, hit ? 140 : -70, true),
    team2: side(5, hit ? 4 : 9, hit ? -50 : 54),
});
const plainRound = (s1 = 80, s2 = -60) => ({
    team1: side(8, 8, s1),
    team2: side(6, 5, s2),
});

const drama = (extra = {}) => ({
    kind: 'blind-hit',
    actor: 'Sky',
    matchId: MATCH_ID,
    teams: { t1: 'Sky', t2: 'K2' },
    ...extra,
});

describe('counters — computed from rounds, never from prose', () => {
    beforeEach(() => {
        CommentaryLog._setStorage(fakeStorage());
        CommentaryLog.clear();
    });

    test('counts blinds for the right team', () => {
        const m = match([blindRound(), plainRound(), blindRound()]);
        expect(Callbacks.blindCount(m, 't1')).toBe(2);
        expect(Callbacks.blindCount(m, 't2')).toBe(0);
    });

    test('recognises a historical blind by its +140 signature', () => {
        // Older rows carry no blind flag; +140 is unambiguous (CLAUDE.md §4.4).
        const m = match([{ team1: side(7, 9, 140), team2: side(5, 4, -50) }]);
        expect(Callbacks.blindCount(m, 't1')).toBe(1);
    });

    test('negative streak counts back from the most recent round only', () => {
        const m = match([plainRound(-40, 50), plainRound(80, -60), plainRound(-70, 90), plainRound(-40, 50)]);
        // team1: -40, 80, -70, -40 → streak from the end is 2.
        expect(Callbacks.negativeStreak(m, 't1')).toBe(2);
    });

    test('a positive most-recent round means no streak at all', () => {
        const m = match([plainRound(-40, 50), plainRound(80, -60)]);
        expect(Callbacks.negativeStreak(m, 't1')).toBe(0);
    });

    test('counts a repeated bid', () => {
        const m = match([plainRound(), plainRound(), plainRound()]);
        expect(Callbacks.sameBidCount(m, 't1', 8)).toBe(3);
        expect(Callbacks.sameBidCount(m, 't1', 4)).toBe(0);
    });

    test('an unknown team yields nothing rather than guessing', () => {
        const m = match([blindRound()]);
        expect(Callbacks.blindCount(m, 'nope')).toBe(0);
        expect(Callbacks.negativeStreak(m, 'nope')).toBe(0);
    });
});

describe('forMoment — when a callback fires', () => {
    beforeEach(() => {
        CommentaryLog._setStorage(fakeStorage());
        CommentaryLog.clear();
    });

    test('a single blind is NOT a callback — one is a coincidence', () => {
        const cb = Callbacks.forMoment(drama(), match([blindRound()]));
        expect(cb).toBeNull();
    });

    test('the second blind fires the callback', () => {
        const cb = Callbacks.forMoment(drama(), match([blindRound(), blindRound()]));
        expect(cb).not.toBeNull();
        expect(cb.kind).toBe('repeat-blind');
        expect(cb.count).toBe(2);
    });

    test('the third blind says "third" — the spec\'s canonical example', () => {
        const m = match([blindRound(), blindRound(), blindRound()]);
        const en = Callbacks.forMoment(drama(), m);
        expect(en.text).toContain('third');

        const hi = Callbacks.forMoment(drama(), m, { lang: 'hinglish' });
        expect(hi.text).toContain('teesra');
    });

    test('a bleed fires when rounds keep ending negative', () => {
        // No blinds, so the streak is the only candidate.
        const m = match([plainRound(-40, 50), plainRound(-70, 90)]);
        const cb = Callbacks.forMoment(drama({ kind: 'routine' }), m);
        expect(cb.kind).toBe('negative-streak');
        expect(cb.count).toBe(2);
    });

    test('the repeated blind outranks the bleed — it is the funnier callback', () => {
        const m = match([blindRound(false), blindRound(false)]);
        const cb = Callbacks.forMoment(drama(), m);
        expect(cb.kind).toBe('repeat-blind');
    });

    test('a same-bid tell needs three, not two', () => {
        const two = match([plainRound(80, -60), plainRound(80, -60)]);
        expect(Callbacks.forMoment(drama({ kind: 'routine' }), two)?.kind)
            .not.toBe('same-bid');

        const three = match([plainRound(80, 10), plainRound(80, 10), plainRound(80, 10)]);
        const cb = Callbacks.forMoment(drama({ kind: 'routine' }), three);
        expect(cb.kind).toBe('same-bid');
        expect(cb.count).toBe(3);
    });

    test('returns null when the actor cannot be resolved — never guesses', () => {
        const m = match([blindRound(), blindRound()]);
        const cb = Callbacks.forMoment(drama({ actor: 'Somebody Else' }), m);
        expect(cb).toBeNull();
    });

    test('a match with no rounds has no callback', () => {
        expect(Callbacks.forMoment(drama(), match([]))).toBeNull();
    });

    test('null inputs are safe', () => {
        expect(Callbacks.forMoment(null, match([]))).toBeNull();
        expect(Callbacks.forMoment(drama(), null)).toBeNull();
    });
});

describe('already-said guard — a repeated callback is a stutter', () => {
    beforeEach(() => {
        CommentaryLog._setStorage(fakeStorage());
        CommentaryLog.clear();
    });

    test('the same callback is not made twice in a match', () => {
        const m = match([blindRound(), blindRound()]);
        const first = Callbacks.forMoment(drama(), m);
        expect(first.tag).toBe('blind:2');

        // Record it as spoken, exactly as the delivery path does.
        CommentaryLog.append(MATCH_ID, {
            kind: 'spoken', round: 2, text: 'whatever was said', callback: first.tag,
        });

        expect(Callbacks.forMoment(drama(), m)).toBeNull();
    });

    test('a NEW blind is a fresh callback even after the last one was said', () => {
        const m2 = match([blindRound(), blindRound()]);
        const first = Callbacks.forMoment(drama(), m2);
        CommentaryLog.append(MATCH_ID, {
            kind: 'spoken', round: 2, text: 'said', callback: first.tag,
        });

        // A third blind is a different observation — "teesra", not "doosra".
        const m3 = match([blindRound(), blindRound(), blindRound()]);
        const next = Callbacks.forMoment(drama(), m3);
        expect(next).not.toBeNull();
        expect(next.tag).toBe('blind:3');
    });

    test('falls through to the next candidate when the best one was used', () => {
        // Two blinds AND a bleed. Burn the blind callback; the bleed should
        // still be available rather than the whole line going callback-less.
        const m = match([blindRound(false), blindRound(false)]);
        const first = Callbacks.forMoment(drama(), m);
        CommentaryLog.append(MATCH_ID, {
            kind: 'spoken', round: 2, text: 'said', callback: first.tag,
        });

        const second = Callbacks.forMoment(drama(), m);
        expect(second).not.toBeNull();
        expect(second.kind).toBe('negative-streak');
    });

    test('a callback burned in one match does not affect another', () => {
        const m = match([blindRound(), blindRound()]);
        const cb = Callbacks.forMoment(drama(), m);
        CommentaryLog.append(MATCH_ID, {
            kind: 'spoken', round: 2, text: 'said', callback: cb.tag,
        });

        const other = { ...m, id: 'other-match' };
        const otherDrama = drama({ matchId: 'other-match' });
        expect(Callbacks.forMoment(otherDrama, other)).not.toBeNull();
    });
});

describe('the log stores the callback tag', () => {
    beforeEach(() => {
        CommentaryLog._setStorage(fakeStorage());
        CommentaryLog.clear();
    });

    test('a tag round-trips through storage', () => {
        CommentaryLog.append(MATCH_ID, {
            kind: 'spoken', round: 3, text: 'line', callback: 'blind:3',
        });
        expect(CommentaryLog.entries(MATCH_ID)[0].callback).toBe('blind:3');
    });

    test('an entry with no callback stores no tag', () => {
        CommentaryLog.append(MATCH_ID, { kind: 'spoken', round: 1, text: 'line' });
        expect(CommentaryLog.entries(MATCH_ID)[0].callback).toBeUndefined();
    });
});
