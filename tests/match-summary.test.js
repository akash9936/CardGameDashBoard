const StatsUtils = require('../js/utils/stats.js');

function round(num, t1, t2) {
    return { roundNumber: num, team1: t1, team2: t2 };
}

function mkMatch(rounds) {
    return { id: 'm1', team1Id: 'a', team2Id: 'b', status: 'completed', rounds };
}

describe('StatsUtils.matchSummary — match-card chip data', () => {
    test('empty match → zeroed summary', () => {
        const s = StatsUtils.matchSummary(mkMatch([]));
        expect(s).toEqual({
            blinds: 0,
            overExtensions: 0,
            biggestSwing: { round: null, delta: 0 },
            totalRounds: 0,
        });
    });

    test('single normal round → counts the round, no blinds, swing = |s1−s2|', () => {
        const s = StatsUtils.matchSummary(mkMatch([
            round(1,
                { promise: 8, actual: 10, score: 82, blind: false },
                { promise: 5, actual: 3,  score: -50, blind: false }),
        ]));
        expect(s.totalRounds).toBe(1);
        expect(s.blinds).toBe(0);
        expect(s.overExtensions).toBe(0);
        expect(s.biggestSwing).toEqual({ round: 1, delta: 132 });
    });

    test('blind sides are counted (success + failure)', () => {
        const s = StatsUtils.matchSummary(mkMatch([
            round(1,
                { promise: 7, actual: 8, score: 140, blind: true },
                { promise: 7, actual: 4, score: -70, blind: true }),
        ]));
        expect(s.blinds).toBe(2);
        // Blind sides MUST NOT count as over-extensions even if actual ≥ 14.
        expect(s.overExtensions).toBe(0);
        expect(s.biggestSwing.delta).toBe(210);
    });

    test('non-blind over-extension is flagged when actual ≥ promise × 2', () => {
        const s = StatsUtils.matchSummary(mkMatch([
            round(1,
                { promise: 4, actual: 9, score: -40, blind: false },
                { promise: 5, actual: 4, score: -50, blind: false }),
        ]));
        expect(s.overExtensions).toBe(1);
    });

    test('biggest swing picks the largest |team1.score − team2.score| across rounds', () => {
        const s = StatsUtils.matchSummary(mkMatch([
            round(1,
                { promise: 5, actual: 5, score: 50, blind: false },
                { promise: 6, actual: 8, score: 62, blind: false }), // delta = 12
            round(2,
                { promise: 7, actual: 8, score: 140, blind: true },
                { promise: 5, actual: 5, score: -50, blind: false }), // delta = 190
            round(3,
                { promise: 8, actual: 8, score: 80, blind: false },
                { promise: 5, actual: 5, score: 50, blind: false }), // delta = 30
        ]));
        expect(s.totalRounds).toBe(3);
        expect(s.biggestSwing).toEqual({ round: 2, delta: 190 });
    });

    test('handles missing side fields gracefully', () => {
        const s = StatsUtils.matchSummary(mkMatch([
            { roundNumber: 1, team1: null, team2: { promise: 5, actual: 5, score: 50, blind: false } },
        ]));
        expect(s.totalRounds).toBe(1);
        expect(s.blinds).toBe(0);
        expect(s.overExtensions).toBe(0);
        // One side is null (treated as 0 for swing math).
        expect(s.biggestSwing).toEqual({ round: 1, delta: 50 });
    });
});
