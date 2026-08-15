const FactsEngine = require('../js/utils/factsEngine.js');

// The continuity wiring (ai-continuity.md § Wiring): factsPacket may carry
// `memory`, `session` and `players`, and the three of them together with
// `nuggets` must never exceed MAX_PACKET_FACTS quotable narrative facts.
// A model handed eight facts writes a list instead of a line.

const TEAMS = [
    { id: 't1', name: 'Alpha' },
    { id: 't2', name: 'Bravo' },
];

function score(promise, actual, blind) {
    if (blind) return actual >= 7 ? 140 : -70;
    if (actual < promise) return -(promise * 10);
    if (actual >= promise * 2) return -(promise * 10);
    return (promise * 10) + (actual - promise);
}

function round(n, p1, a1, p2) {
    const a2 = 13 - a1;
    return {
        roundNumber: n,
        team1: { promise: p1, actual: a1, score: score(p1, a1, false), blind: false },
        team2: { promise: p2, actual: a2, score: score(p2, a2, false), blind: false },
    };
}

let seq = 0;
function match(date, winner, opts = {}) {
    seq++;
    const rounds = opts.rounds || [round(1, 6, 7, 5), round(2, 5, 8, 6)];
    let s1 = 0, s2 = 0;
    for (const r of rounds) { s1 += r.team1.score; s2 += r.team2.score; }
    return {
        id: opts.id || `m${seq}`,
        date,
        team1Id: opts.team1Id || 't1',
        team2Id: opts.team2Id || 't2',
        status: opts.status || 'completed',
        winnerId: winner,
        rounds,
        finalScore: opts.finalScore || { team1: s1, team2: s2 },
    };
}
beforeEach(() => { seq = 0; });

/** A long shared history plus several matches in one night. */
function richHistory() {
    const ms = [];
    for (let i = 0; i < 12; i++) {
        const day = String(10 + i).padStart(2, '0');
        ms.push(match(`2026-04-${day}T22:00:00Z`, 't1'));
    }
    // Three matches on one night, all won by Alpha, so Bravo is winless.
    ms.push(match('2026-05-01T20:00:00Z', 't1'));
    ms.push(match('2026-05-01T21:30:00Z', 't1'));
    return ms;
}

describe('factsPacket continuity fields', () => {
    test('carries memory when the two teams have history', () => {
        const history = richHistory();
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, history.concat([current]));
        expect(Array.isArray(p.memory)).toBe(true);
        expect(p.memory.length).toBeGreaterThan(0);
    });

    test('carries session framing when the night already has matches', () => {
        const history = richHistory();
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, history.concat([current]));
        expect(p.session).toBeTruthy();
        expect(p.session.index).toBe(3);
        expect(p.session.total).toBe(3);
    });

    test('omits session for the first match of a night', () => {
        const current = match('2026-06-01T22:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, [current]);
        expect(p.session).toBeUndefined();
    });

    test('omits memory when the teams have never met', () => {
        const current = match('2026-06-01T22:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, [current]);
        expect(p.memory).toBeUndefined();
    });

    test('never exceeds the narrative-fact ceiling', () => {
        const history = richHistory();
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, history.concat([current]));
        const total = (p.nuggets || []).length
            + (p.memory || []).length
            + (p.players || []).length;
        expect(total).toBeLessThanOrEqual(FactsEngine.MAX_PACKET_FACTS);
    });

    test('continuity can be switched off entirely', () => {
        const history = richHistory();
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, history.concat([current]), {
            continuity: false,
        });
        expect(p.memory).toBeUndefined();
        expect(p.session).toBeUndefined();
        expect(p.players).toBeUndefined();
        // The pre-continuity packet is untouched.
        expect(p.teams).toEqual({ t1: 'Alpha', t2: 'Bravo' });
        expect(Array.isArray(p.nuggets)).toBe(true);
    });

    test('the original packet contract is unchanged', () => {
        const history = richHistory();
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        const p = FactsEngine.factsPacket(current, TEAMS, history.concat([current]));
        expect(p.kind).toBe('live');
        expect(p.matchId).toBe(current.id);
        expect(p.score).toEqual({
            t1: current.finalScore.team1,
            t2: current.finalScore.team2,
        });
        expect(p.roundsPlayed).toBe(2);
        expect(p.lastRound).toBeTruthy();
        expect(p.winProb).toBeTruthy();
        expect(p.nuggets.length).toBeLessThanOrEqual(3);
    });

    test('a match with no usable date still produces a packet', () => {
        const current = Object.assign(
            match('2026-05-01T23:00:00Z', null, { status: 'in_progress' }),
            { date: null },
        );
        const p = FactsEngine.factsPacket(current, TEAMS, [current]);
        expect(p.session).toBeUndefined();
        expect(p.matchId).toBe(current.id);
    });

    // Malformed rows the continuity layer must tolerate. `null` entries are
    // deliberately NOT included: winProbability has always dereferenced
    // match.team1Id directly and would throw on those with or without this
    // feature, so asserting otherwise here would be testing a pre-existing
    // limitation rather than the continuity wiring.
    test('continuity tolerates incomplete history rows', () => {
        const junk = [
            {},
            { id: 'x', rounds: null },
            { id: 'y', date: 'nope', status: 'completed' },
            { id: 'z', team1Id: 't1', team2Id: 't2', status: 'completed', winnerId: null },
        ];
        const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
        expect(() => FactsEngine.factsPacket(current, TEAMS, junk.concat([current])))
            .not.toThrow();
    });

    test('a continuity module that throws never breaks the packet', () => {
        // The layer is wrapped in try/catch precisely so a bad roster edit or
        // an unexpected history row degrades to "no extra facts", never to a
        // broken broadcast.
        const original = globalThis.LeagueMemory;
        globalThis.LeagueMemory = {
            nuggets() { throw new Error('boom'); },
        };
        try {
            const current = match('2026-05-01T23:00:00Z', null, { status: 'in_progress' });
            const p = FactsEngine.factsPacket(current, TEAMS, richHistory().concat([current]));
            expect(p.memory).toBeUndefined();
            expect(p.matchId).toBe(current.id);
        } finally {
            if (original === undefined) delete globalThis.LeagueMemory;
            else globalThis.LeagueMemory = original;
        }
    });
});
