const SessionArc = require('../js/utils/sessionArc.js');

// ─── Fixtures ───────────────────────────────────────────────────────────────
const TEAMS = [
    { id: 't1', name: 'Alpha' },
    { id: 't2', name: 'Bravo' },
    { id: 't3', name: 'Charlie' },
];

let seq = 0;
function match(date, team1Id, team2Id, opts = {}) {
    seq++;
    return {
        id: opts.id || `m${seq}`,
        date,
        team1Id, team2Id,
        status: opts.status || 'completed',
        winnerId: opts.winnerId === undefined ? team1Id : opts.winnerId,
        rounds: opts.rounds || [],
        finalScore: opts.finalScore || { team1: 500, team2: 300 },
    };
}

beforeEach(() => { seq = 0; });

// ─── Session boundary ───────────────────────────────────────────────────────
describe('SessionArc session boundary', () => {
    test('a match before midnight and one after belong to the same session', () => {
        const before = SessionArc.sessionKeyFor(Date.parse('2026-04-11T23:40:00Z'));
        const after = SessionArc.sessionKeyFor(Date.parse('2026-04-12T00:20:00Z'));
        expect(before).toBe(after);
        expect(before).toBe('2026-04-11');
    });

    test('the boundary sits at 06:00, not at midnight', () => {
        // 05:59 still belongs to the night before; 06:01 starts a new one.
        expect(SessionArc.sessionKeyFor(Date.parse('2026-04-12T05:59:00Z'))).toBe('2026-04-11');
        expect(SessionArc.sessionKeyFor(Date.parse('2026-04-12T06:01:00Z'))).toBe('2026-04-12');
    });

    test('the shift is configurable', () => {
        const t = Date.parse('2026-04-12T02:00:00Z');
        expect(SessionArc.sessionKeyFor(t, { dayShiftHours: 0 })).toBe('2026-04-12');
        expect(SessionArc.sessionKeyFor(t, { dayShiftHours: 6 })).toBe('2026-04-11');
    });

    test('unusable dates yield no key', () => {
        expect(SessionArc.sessionKeyFor(NaN)).toBeNull();
        expect(SessionArc.sessionKeyOf({ date: 'not a date' })).toBeNull();
        expect(SessionArc.sessionKeyOf({})).toBeNull();
    });

    test('accepts ISO strings, Dates, epochs and Firestore timestamps', () => {
        const ms = Date.parse('2026-04-11T22:00:00Z');
        expect(SessionArc.timeOf({ date: '2026-04-11T22:00:00Z' })).toBe(ms);
        expect(SessionArc.timeOf({ date: new Date(ms) })).toBe(ms);
        expect(SessionArc.timeOf({ date: ms })).toBe(ms);
        expect(SessionArc.timeOf({ date: { seconds: ms / 1000 } })).toBe(ms);
    });
});

// ─── Grouping ───────────────────────────────────────────────────────────────
describe('SessionArc.sessionsOf', () => {
    test('groups a night that runs past midnight into one session', () => {
        const matches = [
            match('2026-04-11T22:00:00Z', 't1', 't2'),
            match('2026-04-11T23:30:00Z', 't1', 't2'),
            match('2026-04-12T00:40:00Z', 't1', 't2'),
        ];
        const sessions = SessionArc.sessionsOf(matches);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].count).toBe(3);
    });

    test('separates genuinely different nights', () => {
        const matches = [
            match('2026-04-11T22:00:00Z', 't1', 't2'),
            match('2026-04-13T22:00:00Z', 't1', 't2'),
        ];
        expect(SessionArc.sessionsOf(matches)).toHaveLength(2);
    });

    test('keeps cancelled matches — they happened at the table', () => {
        const matches = [
            match('2026-04-11T22:00:00Z', 't1', 't2'),
            match('2026-04-11T23:00:00Z', 't1', 't2', { status: 'cancelled', winnerId: null }),
        ];
        expect(SessionArc.sessionsOf(matches)[0].count).toBe(2);
    });

    test('drops matches with no usable date', () => {
        const matches = [
            match('2026-04-11T22:00:00Z', 't1', 't2'),
            Object.assign(match('2026-04-11T23:00:00Z', 't1', 't2'), { date: null }),
        ];
        expect(SessionArc.sessionsOf(matches)[0].count).toBe(1);
    });

    test('sessions come back in chronological order', () => {
        const matches = [
            match('2026-04-13T22:00:00Z', 't1', 't2'),
            match('2026-04-11T22:00:00Z', 't1', 't2'),
        ];
        expect(SessionArc.sessionsOf(matches).map(s => s.key))
            .toEqual(['2026-04-11', '2026-04-13']);
    });
});

// ─── The arc ────────────────────────────────────────────────────────────────
describe('SessionArc.current', () => {
    test('the first match of a night has no arc', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2');
        expect(SessionArc.current(m1, [m1], TEAMS)).toBeNull();
    });

    test('counts position within the night', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2');
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't2');
        const arc = SessionArc.current(m2, [m1, m2], TEAMS);
        expect(arc.index).toBe(2);
        expect(arc.total).toBe(2);
    });

    test('only sees matches at or before itself', () => {
        // A commentator at match 2 of 3 does not know about match 3.
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m3 = match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't2' });
        const arc = SessionArc.current(m2, [m1, m2, m3], TEAMS);
        expect(arc.tally).toEqual({ Alpha: 1, Bravo: 0 });
    });

    test('reports a team that has played twice and won nothing', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m3 = match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't1' });
        const arc = SessionArc.current(m3, [m1, m2, m3], TEAMS);
        expect(arc.winless).toEqual(['Bravo']);
    });

    test('a single loss is not yet winless', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' });
        const arc = SessionArc.current(m2, [m1, m2], TEAMS);
        expect(arc.winless).toEqual([]);
    });

    test('three straight losses in a night is tilt', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        const arc = SessionArc.current(ms[3], ms, TEAMS);
        expect(arc.onTilt).toEqual([{ team: 'Bravo', losses: 3 }]);
    });

    test('a win in between breaks the tilt run', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't2' }),
            match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        const arc = SessionArc.current(ms[3], ms, TEAMS);
        expect(arc.onTilt).toEqual([]);
    });

    test('a cancelled match neither counts as a loss nor breaks a run', () => {
        const ms = [
            match('2026-04-11T20:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { status: 'cancelled', winnerId: null }),
            match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        const arc = SessionArc.current(ms[4], ms, TEAMS);
        expect(arc.onTilt).toEqual([{ team: 'Bravo', losses: 3 }]);
    });

    test('detects an immediate rematch and who won it', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't2' });
        const m2 = match('2026-04-11T23:00:00Z', 't2', 't1', { winnerId: 't2' });
        const arc = SessionArc.current(m2, [m1, m2], TEAMS);
        expect(arc.rematchOf).toBe(m1.id);
        expect(arc.previousWinner).toBe('Bravo');
    });

    test('a different pairing is not a rematch', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2');
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't3');
        expect(SessionArc.current(m2, [m1, m2], TEAMS).rematchOf).toBeNull();
    });
});

// ─── Display grouping ───────────────────────────────────────────────────────
describe('SessionArc.groupForDisplay', () => {
    test('groups a night together and keeps every match', () => {
        const ms = [
            match('2026-04-12T00:40:00Z', 't1', 't2'),
            match('2026-04-11T23:30:00Z', 't1', 't2'),
            match('2026-04-09T22:00:00Z', 't1', 't2'),
        ];
        const { groups, undated } = SessionArc.groupForDisplay(ms, TEAMS);
        expect(groups).toHaveLength(2);
        expect(groups[0].matches).toHaveLength(2);
        expect(undated).toEqual([]);
        const total = groups.reduce((s, g) => s + g.matches.length, 0);
        expect(total).toBe(ms.length);
    });

    test('newest night comes first', () => {
        const ms = [
            match('2026-04-09T22:00:00Z', 't1', 't2'),
            match('2026-04-11T22:00:00Z', 't1', 't2'),
        ];
        const { groups } = SessionArc.groupForDisplay(ms, TEAMS);
        expect(groups.map(g => g.key)).toEqual(['2026-04-11', '2026-04-09']);
    });

    test('preserves the incoming order within a night', () => {
        // The list arrives newest-first and must stay that way inside a group.
        const a = match('2026-04-11T23:30:00Z', 't1', 't2', { id: 'later' });
        const b = match('2026-04-11T22:00:00Z', 't1', 't2', { id: 'earlier' });
        const { groups } = SessionArc.groupForDisplay([a, b], TEAMS);
        expect(groups[0].matches.map(m => m.id)).toEqual(['later', 'earlier']);
    });

    test('undated matches are kept, not dropped', () => {
        const dated = match('2026-04-11T22:00:00Z', 't1', 't2');
        const undatedMatch = Object.assign(
            match('2026-04-11T23:00:00Z', 't1', 't2'), { date: null });
        const { groups, undated } = SessionArc.groupForDisplay([dated, undatedMatch], TEAMS);
        expect(groups).toHaveLength(1);
        expect(undated).toHaveLength(1);
    });

    test('an empty list produces no groups', () => {
        expect(SessionArc.groupForDisplay([], TEAMS)).toEqual({ groups: [], undated: [] });
    });
});

describe('SessionArc.summarise', () => {
    const sessionOf = (ms) => ({
        key: 'k', matches: ms, count: ms.length,
        start: SessionArc.timeOf(ms[0]), end: SessionArc.timeOf(ms[ms.length - 1]),
    });

    test('tallies the night and ranks the standings', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        const s = SessionArc.summarise(sessionOf(ms), TEAMS);
        expect(s.completed).toBe(2);
        expect(s.standings[0]).toEqual({ team: 'Alpha', wins: 2, losses: 0, played: 2 });
    });

    test('reports a sweep only when a team played more than once', () => {
        const one = [match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' })];
        expect(SessionArc.summarise(sessionOf(one), TEAMS).sweeper).toBeNull();

        const two = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        expect(SessionArc.summarise(sessionOf(two), TEAMS).sweeper.team).toBe('Alpha');
    });

    test('counts cancelled and live matches separately from completed', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { status: 'cancelled', winnerId: null }),
            match('2026-04-11T23:00:00Z', 't1', 't2', { status: 'in_progress', winnerId: null }),
        ];
        const s = SessionArc.summarise(sessionOf(ms), TEAMS);
        expect(s).toMatchObject({ total: 3, completed: 1, cancelled: 1, live: 1 });
    });

    test('a night of only cancelled matches describes no winner', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { status: 'cancelled', winnerId: null }),
        ];
        const s = SessionArc.summarise(sessionOf(ms), TEAMS);
        expect(s.standings).toEqual([]);
        expect(s.sweeper).toBeNull();
    });

    test('is null for a session with no matches', () => {
        expect(SessionArc.summarise({ key: 'k', matches: [] }, TEAMS)).toBeNull();
        expect(SessionArc.summarise(null, TEAMS)).toBeNull();
    });

    // Regression: a real archive night (2026-08-09) had Sprite v Coke and
    // Gaurav/Akash v KorbaGang. Treating the night's standings as a scoreline
    // rendered "Coke 1-1 KorbaGang" — a head-to-head between two teams that
    // never played each other. Only a night of ONE repeated fixture may be
    // shown as X-Y.
    test('a night of two different fixtures is not a single fixture', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't3', 't2', { winnerId: 't3' }),
        ];
        const s = SessionArc.summarise(sessionOf(ms), TEAMS);
        expect(s.singleFixture).toBe(false);
    });

    test('a night of the same two teams twice is a single fixture', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            // Seating order flips between games; it is still the same fixture.
            match('2026-04-11T22:00:00Z', 't2', 't1', { winnerId: 't1' }),
        ];
        const s = SessionArc.summarise(sessionOf(ms), TEAMS);
        expect(s.singleFixture).toBe(true);
    });

    test('a single completed match is never a single-fixture scoreline', () => {
        // One game is just a result; the header shows the card, not a tally.
        const ms = [match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' })];
        expect(SessionArc.summarise(sessionOf(ms), TEAMS).singleFixture).toBe(false);
    });
});

// ─── Packet shape ───────────────────────────────────────────────────────────
describe('SessionArc.packetSession', () => {
    test('omits empty fields so the packet stays small', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' });
        const m2 = match('2026-04-11T23:00:00Z', 't1', 't3', { winnerId: 't1' });
        const s = SessionArc.packetSession(m2, [m1, m2], TEAMS);
        expect(s).toEqual({ index: 2, total: 2 });
    });

    test('carries winless, tilt and rematch when present', () => {
        const ms = [
            match('2026-04-11T21:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T22:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-11T23:00:00Z', 't1', 't2', { winnerId: 't1' }),
            match('2026-04-12T00:00:00Z', 't1', 't2', { winnerId: 't1' }),
        ];
        const s = SessionArc.packetSession(ms[3], ms, TEAMS);
        expect(s.winless).toEqual(['Bravo']);
        expect(s.onTilt).toEqual(['Bravo (3)']);
        expect(s.rematch).toBe(true);
        expect(s.previousWinner).toBe('Alpha');
    });

    test('is null for the first match of a night', () => {
        const m1 = match('2026-04-11T22:00:00Z', 't1', 't2');
        expect(SessionArc.packetSession(m1, [m1], TEAMS)).toBeNull();
    });
});
