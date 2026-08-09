const StatsUtils = require('../js/utils/stats.js');

const TEAMS = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
];

function round(num, t1, t2) {
    return { roundNumber: num, team1: t1, team2: t2 };
}

function mkMatch(rounds) {
    return { id: 'm1', team1Id: 'a', team2Id: 'b', status: 'completed', rounds };
}

describe('StatsUtils.promiseAccuracy (§4.1)', () => {
    test('empty input → 0 rate, 0 bid', () => {
        const out = StatsUtils.promiseAccuracy(TEAMS, []);
        expect(out.tournament).toEqual({ bid: 0, met: 0, rate: 0 });
        expect(out.byTeam.a).toEqual({ bid: 0, met: 0, rate: 0 });
        expect(out.byTeam.b).toEqual({ bid: 0, met: 0, rate: 0 });
    });

    test('counts met when actual ≥ promise && < promise × 2', () => {
        const out = StatsUtils.promiseAccuracy(TEAMS, [mkMatch([
            round(1,
                { promise: 8, actual: 10, score: 82, blind: false },   // met +extras
                { promise: 5, actual: 3,  score: -50, blind: false }), // under
        ])]);
        expect(out.byTeam.a).toEqual({ bid: 1, met: 1, rate: 1 });
        expect(out.byTeam.b).toEqual({ bid: 1, met: 0, rate: 0 });
        expect(out.tournament).toEqual({ bid: 2, met: 1, rate: 0.5 });
    });

    test('over-extension does NOT count as met (actual ≥ promise × 2)', () => {
        const out = StatsUtils.promiseAccuracy(TEAMS, [mkMatch([
            round(1,
                { promise: 4, actual: 8, score: -40, blind: false },  // over-extension
                { promise: 5, actual: 5, score: 50,  blind: false }), // met exactly
        ])]);
        expect(out.byTeam.a.met).toBe(0);
        expect(out.byTeam.b.met).toBe(1);
    });

    test('blind hit counts as met, blind miss does not', () => {
        const out = StatsUtils.promiseAccuracy(TEAMS, [mkMatch([
            round(1,
                { promise: 7, actual: 8, score: 140, blind: true },   // blind hit → met
                { promise: 7, actual: 5, score: -70, blind: true }),  // blind miss → not met
        ])]);
        expect(out.byTeam.a.met).toBe(1);
        expect(out.byTeam.b.met).toBe(0);
    });

    test('tournament rate is met / bid across all matches', () => {
        const out = StatsUtils.promiseAccuracy(TEAMS, [
            mkMatch([
                round(1,
                    { promise: 8, actual: 10, score: 82, blind: false },
                    { promise: 5, actual: 3,  score: -50, blind: false }),
                round(2,
                    { promise: 6, actual: 7, score: 61, blind: false },
                    { promise: 7, actual: 6, score: -70, blind: false }),
            ]),
        ]);
        // 2 met / 4 bid = 0.5
        expect(out.tournament.bid).toBe(4);
        expect(out.tournament.met).toBe(2);
        expect(out.tournament.rate).toBe(0.5);
    });
});

describe('StatsUtils.blindEconomy (§4.2)', () => {
    test('empty input → zeros everywhere', () => {
        const out = StatsUtils.blindEconomy([]);
        expect(out.tournament).toEqual({ called: 0, successes: 0, failures: 0, successRate: 0, netEV: 0 });
        expect(out.byTeam).toEqual({});
    });

    test('ignores non-blind rounds entirely', () => {
        const out = StatsUtils.blindEconomy([mkMatch([
            round(1,
                { promise: 5, actual: 6, score: 51, blind: false },
                { promise: 6, actual: 7, score: 61, blind: false }),
        ])]);
        expect(out.tournament.called).toBe(0);
    });

    test('counts successes (+140) and failures (-70) per team', () => {
        const out = StatsUtils.blindEconomy([mkMatch([
            round(1,
                { promise: 7, actual: 8, score: 140, blind: true },  // hit → +140
                { promise: 5, actual: 5, score: 50, blind: false }),
            round(2,
                { promise: 7, actual: 5, score: -70, blind: true },  // miss → -70
                { promise: 5, actual: 8, score: 53, blind: false }),
            round(3,
                { promise: 4, actual: 4, score: 40, blind: false },
                { promise: 7, actual: 9, score: 140, blind: true }), // beta hit
        ])]);
        expect(out.byTeam.a).toEqual({ called: 2, successes: 1, failures: 1, netEV: 70 });
        expect(out.byTeam.b).toEqual({ called: 1, successes: 1, failures: 0, netEV: 140 });
        expect(out.tournament.called).toBe(3);
        expect(out.tournament.successes).toBe(2);
        expect(out.tournament.failures).toBe(1);
        expect(out.tournament.netEV).toBe(2 * 140 + 1 * -70); // 210
        expect(out.tournament.successRate).toBeCloseTo(2 / 3, 5);
    });
});
