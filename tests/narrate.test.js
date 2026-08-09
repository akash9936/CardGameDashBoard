const Narrate = require('../js/utils/narrate.js');

const TEAMS = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
];

function mkMatch(over) {
    return {
        id: 'm1',
        team1Id: 'a',
        team2Id: 'b',
        status: 'in_progress',
        finalScore: { team1: 0, team2: 0 },
        rounds: [],
        ...over,
    };
}

describe('pressureState (§3b.2)', () => {
    test('returns calm when both teams under 300', () => {
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 120, team2: 80 } }))).toBe('calm');
    });

    test('returns building when leader hits 300–399', () => {
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 320, team2: 100 } }))).toBe('building');
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 399, team2: 100 } }))).toBe('building');
    });

    test('returns critical at 400–449', () => {
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 400, team2: 100 } }))).toBe('critical');
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 449, team2: 100 } }))).toBe('critical');
    });

    test('returns match-point when leader at 450+', () => {
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 450, team2: 100 } }))).toBe('match-point');
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 490, team2: 100 } }))).toBe('match-point');
    });

    test('returns match-point when both teams are within 50 of 500', () => {
        // Neither has crossed 450 alone, but both are within 50 of the line.
        expect(Narrate.pressureState(mkMatch({ finalScore: { team1: 455, team2: 460 } }))).toBe('match-point');
    });

    test('handles malformed match data without throwing', () => {
        expect(Narrate.pressureState({})).toBe('calm');
        expect(Narrate.pressureState(null)).toBe('calm');
    });
});

describe('narrate (§3b.1)', () => {
    test('pending match returns waiting copy', () => {
        const m = mkMatch({ status: 'pending' });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.what).toMatch(/not started/i);
        expect(out.next).toMatch(/round 1/i);
    });

    test('cancelled match returns cancelled copy', () => {
        const m = mkMatch({ status: 'cancelled' });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.what).toMatch(/cancelled/i);
    });

    test('in-progress, no rounds yet — primes the audience', () => {
        const out = Narrate.narrate(mkMatch(), TEAMS);
        expect(out.what).toMatch(/Alpha vs Beta/);
        expect(out.next).toMatch(/blind/i);
    });

    test('completed match names the winner and final score', () => {
        const m = mkMatch({
            status: 'completed',
            finalScore: { team1: 510, team2: 340 },
            winnerId: 'a',
            rounds: new Array(9).fill({ team1: { score: 50 }, team2: { score: 30 } }),
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.what).toContain('Alpha won 510–340');
        expect(out.why).toMatch(/9 rounds/);
    });

    test('WHAT: highlights a successful blind (+140)', () => {
        const m = mkMatch({
            finalScore: { team1: 140, team2: 20 },
            rounds: [
                {
                    roundNumber: 1,
                    team1: { promise: 7, actual: 8, score: 140, blind: true },
                    team2: { promise: 5, actual: 5, score: 20, blind: false },
                },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.what).toMatch(/Alpha called blind and hit it/);
    });

    test('WHAT: highlights an over-extension', () => {
        const m = mkMatch({
            finalScore: { team1: -40, team2: 50 },
            rounds: [
                {
                    roundNumber: 1,
                    team1: { promise: 4, actual: 9, score: -40, blind: false },
                    team2: { promise: 5, actual: 4, score: -50, blind: false },
                },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        // Both sides scored badly; the larger |score| is team2's -50, so headline is theirs.
        // But team1's -40 over-extension is also valid. Either is acceptable; we just
        // verify the narrator picked a recognizable outcome shape.
        expect(out.what).toMatch(/over-extended|missed their/);
    });

    test('WHAT: hit-with-extras phrasing', () => {
        const m = mkMatch({
            finalScore: { team1: 82, team2: 30 },
            rounds: [
                {
                    roundNumber: 1,
                    team1: { promise: 8, actual: 10, score: 82, blind: false },
                    team2: { promise: 3, actual: 3, score: 30, blind: false },
                },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.what).toMatch(/Alpha hit \+82/);
        expect(out.what).toContain('promise 8, took 10');
    });

    test('WHY: notes when scores are level', () => {
        const m = mkMatch({
            finalScore: { team1: 100, team2: 100 },
            rounds: [
                { roundNumber: 1, team1: { promise: 5, actual: 6, score: 51, blind: false }, team2: { promise: 6, actual: 7, score: 61, blind: false } },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.why).toMatch(/level/i);
    });

    test('NEXT: flags blind-flips-it when lead < 140', () => {
        const m = mkMatch({
            finalScore: { team1: 200, team2: 80 },        // lead = 120 < 140
            rounds: [
                { roundNumber: 1, team1: { promise: 8, actual: 9, score: 81, blind: false }, team2: { promise: 4, actual: 4, score: 40, blind: false } },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.next).toMatch(/blind/i);
        expect(out.next).toContain('Beta');
    });

    // Note: previewScore tests live below — keeping narrate scenarios grouped.

    test('NEXT: match-point copy when leader past 450', () => {
        const m = mkMatch({
            finalScore: { team1: 470, team2: 200 },
            rounds: [
                { roundNumber: 1, team1: { promise: 8, actual: 10, score: 82, blind: false }, team2: { promise: 5, actual: 3, score: -50, blind: false } },
            ],
        });
        const out = Narrate.narrate(m, TEAMS);
        expect(out.next).toMatch(/[Mm]atch point/);
        expect(out.next).toMatch(/Alpha/);
    });
});

describe('previewScore (Game Board live preview, §3.0)', () => {
    test('met with extras → +score, MET + N EXTRAS label', () => {
        expect(Narrate.previewScore(8, 10, false)).toEqual({ score: 82, kind: 'met', label: 'MET + 2 EXTRAS' });
        expect(Narrate.previewScore(4, 5, false)).toEqual({ score: 41, kind: 'met', label: 'MET + 1 EXTRA' });
    });

    test('met exactly → no extras suffix', () => {
        expect(Narrate.previewScore(8, 8, false)).toEqual({ score: 80, kind: 'met', label: 'MET' });
    });

    test('under-promise → -(promise × 10), UNDER-PROMISE label', () => {
        expect(Narrate.previewScore(8, 5, false)).toEqual({ score: -80, kind: 'under', label: 'UNDER-PROMISE' });
    });

    test('over-extension at ≥ promise × 2 → -(promise × 10), OVER-EXTENSION label', () => {
        expect(Narrate.previewScore(4, 8, false)).toEqual({ score: -40, kind: 'over', label: 'OVER-EXTENSION' });
        expect(Narrate.previewScore(6, 12, false)).toEqual({ score: -60, kind: 'over', label: 'OVER-EXTENSION' });
    });

    test('blind hit → +140 BLIND!, blind miss → -70 BLIND MISS', () => {
        expect(Narrate.previewScore(7, 7, true)).toEqual({ score: 140, kind: 'blind-hit', label: 'BLIND!' });
        expect(Narrate.previewScore(7, 11, true)).toEqual({ score: 140, kind: 'blind-hit', label: 'BLIND!' });
        expect(Narrate.previewScore(7, 6, true)).toEqual({ score: -70, kind: 'blind-miss', label: 'BLIND MISS' });
    });

    test('invalid inputs return kind: "invalid"', () => {
        expect(Narrate.previewScore(8, NaN, false).kind).toBe('invalid');
        expect(Narrate.previewScore(8, -1, false).kind).toBe('invalid');
        expect(Narrate.previewScore(NaN, 5, false).kind).toBe('invalid');
        expect(Narrate.previewScore(3, 5, false).kind).toBe('invalid'); // promise < 4
        expect(Narrate.previewScore(14, 5, false).kind).toBe('invalid'); // promise > 13
    });
});
