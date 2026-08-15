const LeagueMemory = require('../js/utils/leagueMemory.js');

const TEAMS = [
    { id: 't1', name: 'Alpha' },
    { id: 't2', name: 'Bravo' },
    { id: 't3', name: 'Charlie' },
];

// Rule-correct scores (CLAUDE.md §4) so the conformance guard does not drop
// fixtures for reasons the test did not intend.
function score(promise, actual, blind) {
    if (blind) return actual >= 7 ? 140 : -70;
    if (actual < promise) return -(promise * 10);
    if (actual >= promise * 2) return -(promise * 10);
    return (promise * 10) + (actual - promise);
}

function round(n, p1, a1, p2, blind1 = false, blind2 = false) {
    const a2 = 13 - a1;
    return {
        roundNumber: n,
        team1: { promise: p1, actual: a1, score: score(p1, a1, blind1), blind: blind1 },
        team2: { promise: p2, actual: a2, score: score(p2, a2, blind2), blind: blind2 },
    };
}

let seq = 0;
function match(date, t1, t2, winner, opts = {}) {
    seq++;
    const rounds = opts.rounds || [round(1, 6, 7, 5)];
    let s1 = 0, s2 = 0;
    for (const r of rounds) { s1 += r.team1.score; s2 += r.team2.score; }
    return {
        id: opts.id || `m${seq}`,
        date, team1Id: t1, team2Id: t2,
        status: opts.status || 'completed',
        winnerId: winner,
        rounds,
        finalScore: opts.finalScore || { team1: s1, team2: s2 },
    };
}

beforeEach(() => { seq = 0; });

// A rivalry of `n` meetings, all won by `winner`, one per night.
function series(n, winner, opts = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const day = String(10 + i).padStart(2, '0');
        out.push(match(`2026-04-${day}T22:00:00Z`, 't1', 't2', winner, opts));
    }
    return out;
}

describe('LeagueMemory.rivalry', () => {
    test('is null when the two have never completed a match', () => {
        expect(LeagueMemory.rivalry('t1', 't3', [], TEAMS)).toBeNull();
    });

    test('counts meetings and wins from each side', () => {
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't1'),
            match('2026-04-11T22:00:00Z', 't1', 't2', 't2'),
            match('2026-04-12T22:00:00Z', 't1', 't2', 't1'),
        ];
        const r = LeagueMemory.rivalry('t1', 't2', ms, TEAMS);
        expect(r.meetings).toBe(3);
        expect(r.wins).toEqual({ t1: 2, t2: 1 });
    });

    test('reports scores from the perspective of the teams as passed in', () => {
        // Seated Bravo-first, but queried Alpha-first: the scores must flip.
        const m = match('2026-04-10T22:00:00Z', 't2', 't1', 't2', {
            finalScore: { team1: 500, team2: 120 },
        });
        const r = LeagueMemory.rivalry('t1', 't2', [m], TEAMS);
        expect(r.lastMeeting.score).toEqual({ t1: 120, t2: 500 });
        expect(r.lastMeeting.winner).toBe('Bravo');
    });

    test('excludes cancelled and in-progress matches', () => {
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't1'),
            match('2026-04-11T22:00:00Z', 't1', 't2', null, { status: 'cancelled' }),
            match('2026-04-12T22:00:00Z', 't1', 't2', null, { status: 'in_progress' }),
        ];
        expect(LeagueMemory.rivalry('t1', 't2', ms, TEAMS).meetings).toBe(1);
    });

    test('excludes the match being commentated from its own history', () => {
        const ms = series(3, 't1');
        const r = LeagueMemory.rivalry('t1', 't2', ms, TEAMS, { excludeMatchId: ms[2].id });
        expect(r.meetings).toBe(2);
    });

    test('recent form looks at the last five meetings only', () => {
        const ms = series(8, 't1');
        const r = LeagueMemory.rivalry('t1', 't2', ms, TEAMS);
        expect(r.meetings).toBe(8);
        expect(r.recentForm).toEqual({ window: 5, t1: 5, t2: 0 });
    });

    test('biggest margin prefers rule-conformant matches', () => {
        // A legacy +160 is impossible under §4 and must not own the record.
        const bogus = match('2026-04-10T22:00:00Z', 't1', 't2', 't1', {
            rounds: [{
                roundNumber: 1,
                team1: { promise: 7, actual: 7, score: 160, blind: false },
                team2: { promise: 5, actual: 6, score: 51, blind: false },
            }],
            finalScore: { team1: 900, team2: 10 },
        });
        const clean = match('2026-04-11T22:00:00Z', 't1', 't2', 't1', {
            finalScore: { team1: 500, team2: 300 },
        });
        const r = LeagueMemory.rivalry('t1', 't2', [bogus, clean], TEAMS);
        expect(r.biggestMargin.margin).toBe(200);
    });
});

describe('LeagueMemory.patterns', () => {
    test('needs at least three meetings before claiming a pattern', () => {
        expect(LeagueMemory.patterns('t1', 't2', series(2, 't1'), TEAMS)).toEqual([]);
    });

    test('reports a losing run and the matching winning run', () => {
        const p = LeagueMemory.patterns('t1', 't2', series(4, 't1'), TEAMS);
        expect(p).toContainEqual({ kind: 'winning-run', team: 'Alpha', side: 't1', count: 4 });
        expect(p).toContainEqual({ kind: 'losing-run', team: 'Bravo', side: 't2', count: 4 });
    });

    test('a run is broken by a single result the other way', () => {
        const ms = series(4, 't1');
        ms[3].winnerId = 't2';
        const p = LeagueMemory.patterns('t1', 't2', ms, TEAMS);
        expect(p.find(x => x.kind === 'winning-run' && x.team === 'Alpha')).toBeUndefined();
    });

    test('blind appetite needs volume, not mere presence', () => {
        // One blind per meeting is unremarkable — 81% of sides do it.
        const single = series(5, 't1', { rounds: [round(1, 7, 7, 5, true, false)] });
        const p1 = LeagueMemory.patterns('t1', 't2', single, TEAMS);
        expect(p1.find(x => x.kind === 'blind-appetite')).toBeUndefined();

        // Two-plus per meeting is a genuine habit.
        const heavy = series(5, 't1', {
            rounds: [round(1, 7, 7, 5, true, false), round(2, 7, 8, 5, true, false)],
        });
        const p2 = LeagueMemory.patterns('t1', 't2', heavy, TEAMS);
        expect(p2.find(x => x.kind === 'blind-appetite' && x.team === 'Alpha')).toBeTruthy();
    });
});

describe('LeagueMemory.nuggets', () => {
    test('is empty with no shared history', () => {
        const m = match('2026-04-10T22:00:00Z', 't1', 't2', 't1');
        expect(LeagueMemory.nuggets(m, [m], TEAMS)).toEqual([]);
    });

    test('never exceeds the nugget cap', () => {
        const ms = series(12, 't1');
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't1');
        const out = LeagueMemory.nuggets(current, ms.concat([current]), TEAMS);
        expect(out.length).toBeLessThanOrEqual(LeagueMemory.MAX_NUGGETS);
    });

    test('leads with the tightest recency band available', () => {
        const ms = series(12, 't1');
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't1');
        const out = LeagueMemory.nuggets(current, ms.concat([current]), TEAMS);
        expect(out[0]).toMatch(/last meeting/i);
    });

    test('quotes a scoreline only when the match is rule-conformant', () => {
        const bogus = match('2026-04-10T22:00:00Z', 't1', 't2', 't1', {
            rounds: [{
                roundNumber: 1,
                team1: { promise: 7, actual: 7, score: 160, blind: false },
                team2: { promise: 5, actual: 6, score: 51, blind: false },
            }],
            finalScore: { team1: 900, team2: 10 },
        });
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't1');
        const out = LeagueMemory.nuggets(current, [bogus, current], TEAMS);
        expect(out[0]).toBe('Alpha took their last meeting.');
        expect(out[0]).not.toMatch(/900/);
    });

    test('does not treat an even recent split as a story', () => {
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't1'),
            match('2026-04-11T22:00:00Z', 't1', 't2', 't2'),
            match('2026-04-12T22:00:00Z', 't1', 't2', 't1'),
            match('2026-04-13T22:00:00Z', 't1', 't2', 't2'),
        ];
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't1');
        const out = LeagueMemory.nuggets(current, ms.concat([current]), TEAMS);
        expect(out.join(' ')).not.toMatch(/have taken \d of the last/);
    });

    test('returns no duplicates', () => {
        const ms = series(12, 't1');
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't1');
        const out = LeagueMemory.nuggets(current, ms.concat([current]), TEAMS);
        expect(new Set(out).size).toBe(out.length);
    });
});
