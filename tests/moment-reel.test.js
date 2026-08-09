const StatsUtils = require('../js/utils/stats.js');

function round(n, t1Score, t2Score, t1 = {}, t2 = {}) {
    return {
        roundNumber: n,
        team1: { promise: 5, actual: 5, score: t1Score, blind: false, ...t1 },
        team2: { promise: 5, actual: 5, score: t2Score, blind: false, ...t2 },
    };
}

function mkMatch(rounds) {
    return { id: 'm', team1Id: 'a', team2Id: 'b', status: 'completed', rounds };
}

describe('StatsUtils.momentReel (§4.0)', () => {
    test('empty match → all slots null', () => {
        const r = StatsUtils.momentReel(mkMatch([]));
        expect(r).toEqual({ biggestSwing: null, bestBlind: null, worstCall: null });
    });

    test('single round populates biggestSwing', () => {
        const r = StatsUtils.momentReel(mkMatch([round(1, 80, -40)]));
        expect(r.biggestSwing).toMatchObject({
            roundNumber: 1, sideId: 'a', score: 80, delta: 120,
        });
    });

    test('best blind picks the highest positive blind score', () => {
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 50, 20),
            round(2, 140, -20, { promise: 7, actual: 8, score: 140, blind: true }),
            round(3, 60, 30),
        ]));
        expect(r.bestBlind).toMatchObject({
            label: 'BEST BLIND', roundNumber: 2, score: 140, sideId: 'a',
        });
    });

    test('best blind falls back to highest positive non-blind score', () => {
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 50, 20),
            round(2, 90, 30),
        ]));
        expect(r.bestBlind).toMatchObject({ label: 'HIGHEST SCORE', score: 90 });
    });

    test('worst call picks over-extension (negative) on either side', () => {
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 50, 20),
            round(2, -60, 70, { promise: 6, actual: 12, score: -60 }),
            round(3, 70, 30),
        ]));
        expect(r.worstCall).toMatchObject({
            label: 'WORST CALL', roundNumber: 2, score: -60, sideId: 'a',
        });
    });

    test('worst call falls back to biggest under-promise miss when no over-extension', () => {
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 50, 20),
            round(2, -100, 40, { promise: 10, actual: 3, score: -100 }),
        ]));
        expect(r.worstCall).toMatchObject({ label: 'BIGGEST MISS', score: -100 });
    });

    test('best blind and biggest swing may share a round (the headline)', () => {
        // Round 2 maxes both — a +140 blind that's also the biggest swing
        // IS the story; we don't water it down by bumping blind elsewhere.
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 60, 30),
            round(2, 140, -20, { promise: 7, actual: 8, score: 140, blind: true }),
            round(3, 95, 10),
        ]));
        expect(r.biggestSwing.roundNumber).toBe(2);
        expect(r.bestBlind.roundNumber).toBe(2);
        expect(r.bestBlind.score).toBe(140);
    });

    test('worstCall moves off a shared round when an alternative exists', () => {
        // Round 2 is both biggest swing (|150-(-30)|=180) and an over-extension
        // for team2. Round 3 has a smaller under-promise miss → worstCall
        // should pick that fallback so the reel reads as three distinct rounds.
        const r = StatsUtils.momentReel(mkMatch([
            round(1, 50, 30),
            round(2, 150, -30, { /*t1*/ }, { promise: 3, actual: 10, score: -30 }),
            round(3, 40, -50, { /*t1*/ }, { promise: 5, actual: 2, score: -50 }),
        ]));
        expect(r.biggestSwing.roundNumber).toBe(2);
        expect(r.worstCall.roundNumber).toBe(3);
        expect(r.worstCall.score).toBe(-50);
    });

    test('accepts overlap when no alternative round qualifies', () => {
        // Only one round has any negative score; worstCall has no alternative.
        const r = StatsUtils.momentReel(mkMatch([
            round(1, -40, 80, { promise: 4, actual: 9, score: -40 }),
        ]));
        expect(r.biggestSwing.roundNumber).toBe(1);
        expect(r.worstCall.roundNumber).toBe(1); // overlap accepted
    });
});
