const SeasonDigest = require('../js/utils/seasonDigest.js');

// ─── Fixture builders ───────────────────────────────────────────────────────
// Rounds are built with rule-correct scores (CLAUDE.md §4) so that the
// conformance guards inside the digest do not silently drop them.
function score(promise, actual, blind) {
    if (blind) return actual >= 7 ? 140 : -70;
    if (actual < promise) return -(promise * 10);
    if (actual >= promise * 2) return -(promise * 10);
    return (promise * 10) + (actual - promise);
}

// side(promise, actual, blind) — actual on the other side is 13 - actual (§3.2)
function round(n, p1, a1, p2, blind1 = false, blind2 = false) {
    const a2 = 13 - a1;
    return {
        roundNumber: n,
        team1: { promise: p1, actual: a1, score: score(p1, a1, blind1), blind: blind1 },
        team2: { promise: p2, actual: a2, score: score(p2, a2, blind2), blind: blind2 },
    };
}

function match(id, t1, t2, rounds, overrides = {}) {
    const finalScore = rounds.reduce((acc, r) => ({
        team1: acc.team1 + r.team1.score,
        team2: acc.team2 + r.team2.score,
    }), { team1: 0, team2: 0 });
    const winnerId = finalScore.team1 >= finalScore.team2 ? t1 : t2;
    return {
        id: String(id),
        team1Id: t1,
        team2Id: t2,
        status: 'completed',
        date: `2026-01-${String((id % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        rounds,
        finalScore,
        winnerId,
        ...overrides,
    };
}

const TEAMS = [
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
    { id: 3, name: 'Gamma' },
];

describe('SeasonDigest.overview', () => {
    test('counts rounds, hands and blinds across completed matches only', () => {
        const matches = [
            match(1, 1, 2, [round(1, 5, 6, 6, false, false), round(2, 4, 5, 7, false, true)]),
            { id: '99', team1Id: 1, team2Id: 3, status: 'in_progress', rounds: [round(1, 5, 5, 5)], finalScore: { team1: 50, team2: 0 } },
        ];
        const o = SeasonDigest.overview(TEAMS, matches);

        expect(o.matchesCompleted).toBe(1);
        expect(o.matchesTotal).toBe(2);
        expect(o.rounds).toBe(2);
        expect(o.handsDealt).toBe(26);      // 2 rounds × 13 hands (§3.2)
        expect(o.blindsCalled).toBe(1);
    });

    test('counts an over-extension as such (actual >= promise x2, §4.3)', () => {
        // team1 promises 4 and takes 8 → over-extension, −40
        const matches = [match(1, 1, 2, [round(1, 4, 8, 5)])];
        const o = SeasonDigest.overview(TEAMS, matches);
        expect(o.overExtensions).toBe(1);
        expect(o.negativeRounds).toBeGreaterThanOrEqual(1);
    });
});

describe('SeasonDigest.promiseBands', () => {
    test('groups by promised number and reports met/bust rates per band', () => {
        const matches = [
            // Three 5-promises: two met, one busted (actual 10 = 5 × 2, §4.3)
            match(1, 1, 2, [
                round(1, 5, 6, 4),
                round(2, 5, 5, 4),
                round(3, 5, 10, 4),
            ]),
        ];
        const bands = SeasonDigest.promiseBands(matches);
        const five = bands.find(b => b.promise === 5);

        expect(five.called).toBe(3);
        expect(five.metPct).toBe(67);       // 2 of 3
        expect(five.bustPct).toBe(33);      // 1 of 3
    });

    test('excludes blind sides — a blind is not a promise band', () => {
        const matches = [match(1, 1, 2, [round(1, 7, 8, 5, true, false)])];
        const bands = SeasonDigest.promiseBands(matches);
        expect(bands.find(b => b.promise === 7)).toBeUndefined();
    });
});

describe('SeasonDigest.records', () => {
    test('picks longest and shortest matches and the closest finish', () => {
        const matches = [
            match(1, 1, 2, [round(1, 5, 6, 4), round(2, 5, 6, 4), round(3, 5, 6, 4)]),
            match(2, 1, 3, [round(1, 5, 6, 4)]),
        ];
        const r = SeasonDigest.records(TEAMS, matches);

        expect(r.longestMatch.rounds).toBe(3);
        expect(r.shortestMatch.rounds).toBe(1);
        expect(r.closestFinish.margin).toBeGreaterThanOrEqual(0);
    });

    test('a legacy non-conformant score cannot own a record', () => {
        // A hand-typed +999 that the locked rules cannot produce.
        const bogus = match(1, 1, 2, [round(1, 5, 6, 4)]);
        bogus.rounds[0].team1.score = 999;

        const honest = match(2, 1, 3, [round(1, 6, 7, 4)]);
        const r = SeasonDigest.records(TEAMS, [bogus, honest]);

        expect(r.bestSingleRound.score).not.toBe(999);
    });
});

describe('SeasonDigest.teamProfiles', () => {
    test('reports blind hit rate and promise reliability per team', () => {
        const matches = [
            match(1, 1, 2, [
                round(1, 7, 8, 4, true, false),   // Alpha blind lands  → +140
                round(2, 7, 3, 4, true, false),   // Alpha blind misses → −70
            ]),
        ];
        const alpha = SeasonDigest.teamProfiles(TEAMS, matches).find(t => t.team === 'Alpha');

        expect(alpha.blindsCalled).toBe(2);
        expect(alpha.blindsLanded).toBe(1);
        expect(alpha.blindHitPct).toBe(50);
        expect(alpha.rounds).toBe(2);
    });

    test('skips teams that have never completed a match', () => {
        const matches = [match(1, 1, 2, [round(1, 5, 6, 4)])];
        const names = SeasonDigest.teamProfiles(TEAMS, matches).map(t => t.team);
        expect(names).not.toContain('Gamma');
    });
});

describe('SeasonDigest.rivalries', () => {
    test('only pairs that met more than once, with the head-to-head record', () => {
        const matches = [
            match(1, 1, 2, [round(1, 5, 6, 4)]),
            match(2, 1, 2, [round(1, 5, 6, 4)]),
            match(3, 1, 3, [round(1, 5, 6, 4)]),   // single meeting — excluded
        ];
        const rivals = SeasonDigest.rivalries(TEAMS, matches);

        expect(rivals).toHaveLength(1);
        expect(rivals[0].meetings).toBe(2);
        expect(rivals[0].pair).toBe('Alpha vs Beta');
    });
});

describe('SeasonDigest.streaks', () => {
    test('finds the longest win streak in date order', () => {
        const matches = [
            match(1, 1, 2, [round(1, 5, 6, 4)]),
            match(2, 1, 2, [round(1, 5, 6, 4)]),
            match(3, 1, 2, [round(1, 5, 6, 4)]),
        ];
        const s = SeasonDigest.streaks(TEAMS, matches);
        expect(s.longestWinStreak.team).toBe('Alpha');
        expect(s.longestWinStreak.count).toBe(3);
    });
});

describe('SeasonDigest — excluded test teams', () => {
    // Coke and Sprite were the seed teams used while building the app. Their
    // rows are real in Firestore but the play is not, so nothing they did may
    // reach a season record.
    const WITH_TEST = [...TEAMS, { id: 90, name: 'Coke' }, { id: 91, name: 'Sprite' }];

    // A fabricated blowout of the kind the seed data actually contained.
    const seedBlowout = match(50, 90, 91, [
        round(1, 12, 6, 4), round(2, 12, 6, 4), round(3, 12, 6, 4),
    ]);
    const realMatch = match(1, 1, 2, [round(1, 5, 6, 4)]);

    test('drops excluded teams from the team profiles', () => {
        const d = SeasonDigest.build(WITH_TEST, [realMatch, seedBlowout]);
        const names = d.teams.map(t => t.team);
        expect(names).not.toContain('Coke');
        expect(names).not.toContain('Sprite');
    });

    test('drops their matches from the counts and the records', () => {
        const d = SeasonDigest.build(WITH_TEST, [realMatch, seedBlowout]);
        expect(d.overview.matchesCompleted).toBe(1);
        expect(d.records.biggestBlowout.match).not.toMatch(/Coke|Sprite/);
    });

    test('reports what it excluded, so the count is auditable', () => {
        const d = SeasonDigest.build(WITH_TEST, [realMatch, seedBlowout]);
        expect(d.generatedFrom.excludedTeams).toBe(2);
        expect(d.generatedFrom.excludedMatches).toBe(1);
    });

    test('matches by name case-insensitively, so re-seeded ids still exclude', () => {
        const renamed = [...TEAMS, { id: 'xyz', name: 'COKE' }];
        const ids = SeasonDigest.excludedIdSet(renamed);
        expect(ids.has('xyz')).toBe(true);
    });

    test('a season of only real teams is left completely untouched', () => {
        const d = SeasonDigest.build(TEAMS, [realMatch]);
        expect(d.generatedFrom.excludedTeams).toBe(0);
        expect(d.generatedFrom.excludedMatches).toBe(0);
        expect(d.overview.matchesCompleted).toBe(1);
    });

    test('the exclusion list is overridable per call', () => {
        const d = SeasonDigest.build(TEAMS, [realMatch], { excludeTeams: ['Alpha'] });
        expect(d.teams.map(t => t.team)).not.toContain('Alpha');
    });
});

describe('SeasonDigest.build', () => {
    test('produces a packet with every section and no undefined branches', () => {
        const matches = [
            match(1, 1, 2, [round(1, 5, 6, 4), round(2, 7, 9, 4, true, false)]),
            match(2, 1, 2, [round(1, 6, 7, 5)]),
        ];
        const d = SeasonDigest.build(TEAMS, matches);

        for (const key of ['overview', 'teams', 'promiseBands', 'blinds',
                           'records', 'rivalries', 'streaks', 'oddities']) {
            expect(d[key]).toBeDefined();
        }
        expect(Array.isArray(d.teams)).toBe(true);
        expect(d.overview.matchesCompleted).toBe(2);
    });

    test('survives an empty season without throwing', () => {
        expect(() => SeasonDigest.build([], [])).not.toThrow();
        const d = SeasonDigest.build([], []);
        expect(d.overview.rounds).toBe(0);
        expect(d.teams).toEqual([]);
    });
});
