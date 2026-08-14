const FactsEngine = require('../js/utils/factsEngine.js');

// ─── Seeded RNG (mulberry32) — Monte Carlo runs must be deterministic ───────
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Fixture builders ───────────────────────────────────────────────────────
// A completed "history" match whose every round scores s1/s2 — the way to
// hand-craft a team's round-score pool. n ≥ MIN_POOL keeps the global pool
// from being blended in, so tests control the distribution exactly.
let _mid = 0;
function historyMatch(t1, t2, n, s1, s2, overrides = {}) {
    const rounds = [];
    let tot1 = 0, tot2 = 0;
    for (let i = 1; i <= n; i++) {
        rounds.push({
            roundNumber: i,
            team1: { promise: 5, actual: 5, score: s1, blind: false },
            team2: { promise: 5, actual: 5, score: s2, blind: false },
        });
        tot1 += s1; tot2 += s2;
    }
    return {
        id: `m${++_mid}`,
        team1Id: t1, team2Id: t2,
        status: 'completed',
        date: overrides.date || '2026-01-01',
        rounds,
        finalScore: { team1: tot1, team2: tot2 },
        winnerId: tot1 >= tot2 ? t1 : t2,
        ...overrides,
    };
}

function liveMatch(t1, t2, s1, s2, rounds = []) {
    return {
        id: `m${++_mid}`,
        team1Id: t1, team2Id: t2,
        status: 'in_progress',
        date: '2026-02-01',
        rounds,
        finalScore: { team1: s1, team2: s2 },
        winnerId: null,
    };
}

const TEAMS = [
    { id: 'A', name: 'Alpha' },
    { id: 'B', name: 'Bravo' },
    { id: 'C', name: 'Charlie' },
];

// ─── winProbability ─────────────────────────────────────────────────────────
describe('FactsEngine.winProbability', () => {
    test('completed match returns certainty for the winner', () => {
        const m = historyMatch('A', 'B', 5, 110, 20);
        const p = FactsEngine.winProbability(m, [m]);
        expect(p.team1).toBe(1);
        expect(p.team2).toBe(0);
    });

    test('a dominant scorer is a near-certain favourite', () => {
        // Alpha always +110/round, Bravo always −70/round (25 rounds each →
        // pools are pure, no global blend).
        const history = [historyMatch('A', 'C', 25, 110, -70), historyMatch('B', 'C', 25, -70, 110)];
        const live = liveMatch('A', 'B', 0, 0);
        const p = FactsEngine.winProbability(live, history.concat([live]), {
            iterations: 500, rng: mulberry32(42),
        });
        expect(p.team1).toBe(1);
        expect(p.team2).toBe(0);
    });

    test('identical teams sit near 50%', () => {
        // Both teams draw from the same varied multiset of round scores.
        // (Constant identical pools would tie every simulation exactly —
        // and the tie rule hands all of those to team1.)
        const varied = (t1, t2) => {
            const m = historyMatch(t1, t2, 30, 0, 0);
            m.rounds.forEach((r, i) => {
                const s = [-80, -40, 43, 54, 61, 72][i % 6];
                r.team1.score = s;
                r.team2.score = -1000;   // opponent side ('C') is irrelevant
            });
            return m;
        };
        const history = [varied('A', 'C'), varied('B', 'C')];
        const live = liveMatch('A', 'B', 0, 0);
        const p = FactsEngine.winProbability(live, history.concat([live]), {
            iterations: 1000, rng: mulberry32(7),
        });
        // Identical pools; team1 only edges ahead via the exact-tie rule.
        expect(p.team1).toBeGreaterThan(0.4);
        expect(p.team1).toBeLessThan(0.7);
        expect(p.team1 + p.team2).toBeCloseTo(1);
    });

    test('simultaneous ≥500 with exact tie goes to team1 (locked rule)', () => {
        // Both cross 500 on the same simulated round with identical totals.
        const history = [historyMatch('A', 'B', 25, 500, 500)];
        const live = liveMatch('A', 'B', 0, 0);
        const p = FactsEngine.winProbability(live, history.concat([live]), {
            iterations: 200, rng: mulberry32(1),
        });
        expect(p.team1).toBe(1);
    });

    test('simultaneous ≥500 goes to the higher total (locked rule)', () => {
        const history = [historyMatch('A', 'B', 25, 500, 501)];
        const live = liveMatch('A', 'B', 0, 0);
        const p = FactsEngine.winProbability(live, history.concat([live]), {
            iterations: 200, rng: mulberry32(1),
        });
        expect(p.team2).toBe(1);
    });

    test('pathological all-negative pools hit the cap and award the leader', () => {
        const history = [historyMatch('A', 'B', 25, -40, -40)];
        const live = liveMatch('A', 'B', 30, 10);   // team1 leads at the cap
        const p = FactsEngine.winProbability(live, history.concat([live]), {
            iterations: 50, rng: mulberry32(3),
        });
        expect(p.team1).toBe(1);
    });

    test('no history at all falls back to the default pool without crashing', () => {
        const live = liveMatch('A', 'B', 0, 0);
        const p = FactsEngine.winProbability(live, [live], {
            iterations: 200, rng: mulberry32(9),
        });
        expect(p.team1 + p.team2).toBeCloseTo(1);
        expect(p.team1).toBeGreaterThan(0);
        expect(p.team2).toBeGreaterThan(0);
    });
});

// ─── pool builders ──────────────────────────────────────────────────────────
describe('FactsEngine pools', () => {
    test('roundScorePool collects only that team’s side scores', () => {
        const m = historyMatch('A', 'B', 3, 61, -50);
        expect(FactsEngine.roundScorePool('A', [m])).toEqual([61, 61, 61]);
        expect(FactsEngine.roundScorePool('B', [m])).toEqual([-50, -50, -50]);
        expect(FactsEngine.roundScorePool('C', [m])).toEqual([]);
    });

    test('globalScorePool collects both sides', () => {
        const m = historyMatch('A', 'B', 2, 61, -50);
        expect(FactsEngine.globalScorePool([m]).sort((a, b) => a - b)).toEqual([-50, -50, 61, 61]);
    });
});

// ─── comebackOf / missStreak ────────────────────────────────────────────────
describe('FactsEngine derivations', () => {
    test('comebackOf finds the winner’s worst deficit', () => {
        // Bravo leads by 150 after R1, Alpha storms back and wins.
        const m = {
            id: 'cb1', team1Id: 'A', team2Id: 'B', status: 'completed',
            date: '2026-01-05',
            rounds: [
                { roundNumber: 1, team1: { score: -60 }, team2: { score: 90 } },
                { roundNumber: 2, team1: { score: 140 }, team2: { score: -70 } },
                { roundNumber: 3, team1: { score: 500 }, team2: { score: 0 } },
            ],
            finalScore: { team1: 580, team2: 20 },
            winnerId: 'A',
        };
        const c = FactsEngine.comebackOf(m);
        expect(c.deficit).toBe(150);
        expect(c.winnerId).toBe('A');
    });

    test('comebackOf is null when the winner never trailed', () => {
        const m = historyMatch('A', 'B', 3, 100, 10);
        expect(FactsEngine.comebackOf(m)).toBeNull();
    });

    test('missStreak counts trailing negative rounds only', () => {
        const m = {
            rounds: [
                { team1: { score: 61 }, team2: { score: -50 } },
                { team1: { score: -40 }, team2: { score: 50 } },
                { team1: { score: -60 }, team2: { score: 50 } },
            ],
        };
        expect(FactsEngine.missStreak(m, 'team1')).toBe(2);
        expect(FactsEngine.missStreak(m, 'team2')).toBe(0);
    });
});

// ─── rule conformance (records hygiene) ─────────────────────────────────────
describe('FactsEngine rule conformance', () => {
    test('a side scored per the locked rules conforms', () => {
        expect(FactsEngine.isRuleConformantSide({ promise: 5, actual: 8, score: 53, blind: false })).toBe(true);
        expect(FactsEngine.isRuleConformantSide({ promise: 6, actual: 4, score: -60, blind: false })).toBe(true);
        expect(FactsEngine.isRuleConformantSide({ promise: 4, actual: 8, score: -40, blind: false })).toBe(true);
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 9, score: 140, blind: true })).toBe(true);
    });

    test('a legacy blind missing its flag still conforms', () => {
        // Score is exactly what a blind pays; only `blind` was never stored.
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 7, score: 140, blind: false })).toBe(true);
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 3, score: -70, blind: false })).toBe(true);
    });

    test('scores the rules cannot produce do not conform', () => {
        // The real +160 found in the dump (promise 7, actual 9 → rules say 72).
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 9, score: 160, blind: false })).toBe(false);
        // Blind-plus-extras — the rules pay a flat 140.
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 10, score: 142, blind: true })).toBe(false);
        // Doubled blind penalty from an old house rule.
        expect(FactsEngine.isRuleConformantSide({ promise: 7, actual: 6, score: -140, blind: false })).toBe(false);
    });

    test('a match is conformant only when every side is', () => {
        const good = historyMatch('A', 'B', 3, 0, 0);
        good.rounds.forEach(r => {
            r.team1 = { promise: 5, actual: 5, score: 50, blind: false };
            r.team2 = { promise: 6, actual: 4, score: -60, blind: false };
        });
        expect(FactsEngine.isRuleConformantMatch(good)).toBe(true);

        good.rounds[1].team1.score = 999;
        expect(FactsEngine.isRuleConformantMatch(good)).toBe(false);
    });

    test('records skip rounds the rules cannot produce', () => {
        const clean = historyMatch('A', 'B', 5, 0, 0);
        clean.rounds.forEach(r => {
            r.team1 = { promise: 13, actual: 13, score: 130, blind: false };
            r.team2 = { promise: 4, actual: 0, score: -40, blind: false };
        });
        const dirty = historyMatch('A', 'C', 5, 0, 0);
        dirty.rounds.forEach(r => {
            r.team1 = { promise: 7, actual: 9, score: 160, blind: false };   // impossible
            r.team2 = { promise: 4, actual: 0, score: -40, blind: false };
        });

        const facts = FactsEngine.funFacts(TEAMS, [clean, dirty]);
        const top = facts.find(f => f.id === 'top-round-score');
        expect(top.text).toContain('+130');      // the legal record, not +160
        expect(top.text).not.toContain('160');
    });

    test('falls back to all matches when nothing is conformant', () => {
        const dirty = historyMatch('A', 'B', 3, 0, 0);
        dirty.rounds.forEach(r => {
            r.team1 = { promise: 7, actual: 9, score: 160, blind: false };
            r.team2 = { promise: 4, actual: 0, score: -40, blind: false };
        });
        // No conformant match exists — records still get reported rather than
        // the ticker going silent.
        const facts = FactsEngine.funFacts(TEAMS, [dirty]);
        const top = facts.find(f => f.id === 'top-round-score');
        expect(top).toBeTruthy();
        expect(top.text).toContain('+160');
    });
});

// ─── funFacts ───────────────────────────────────────────────────────────────
describe('FactsEngine.funFacts', () => {
    test('produces ranked archive facts from history', () => {
        const history = [
            historyMatch('A', 'B', 12, 50, 40, { date: '2026-01-01' }),
            historyMatch('A', 'C', 4, 130, 20, { date: '2026-01-02' }),
        ];
        const facts = FactsEngine.funFacts(TEAMS, history);
        const ids = facts.map(f => f.id);
        expect(ids).toContain('longest-match');
        expect(ids).toContain('shortest-match');
        const longest = facts.find(f => f.id === 'longest-match');
        expect(longest.text).toContain('12 rounds');
        expect(longest.text).toContain('Alpha');
        // ranked by weight desc
        for (let i = 1; i < facts.length; i++) {
            expect(facts[i - 1].weight).toBeGreaterThanOrEqual(facts[i].weight);
        }
    });

    test('live facts outrank the archive when a match is running', () => {
        const history = [historyMatch('A', 'B', 5, 61, 40)];
        const live = liveMatch('A', 'C', 200, 100,
            Array.from({ length: 6 }, (_, i) => ({
                roundNumber: i + 1,
                team1: { promise: 5, actual: 5, score: 50, blind: false },
                team2: { promise: 5, actual: 5, score: 20, blind: false },
            })));
        const facts = FactsEngine.funFacts(TEAMS, history.concat([live]), live, {
            winProbOptions: { iterations: 100, rng: mulberry32(5) },
        });
        const liveLongest = facts.find(f => f.id === 'live-longest');
        expect(liveLongest).toBeTruthy();
        expect(liveLongest.live).toBe(true);
        expect(facts[0].live).toBe(true);   // a live fact leads the ticker
    });

    test('respects the limit option', () => {
        const history = [
            historyMatch('A', 'B', 12, 50, 40),
            historyMatch('A', 'C', 4, 130, 20),
        ];
        expect(FactsEngine.funFacts(TEAMS, history, null, { limit: 2 }).length).toBe(2);
    });

    test('empty history produces no facts and no crash', () => {
        expect(FactsEngine.funFacts(TEAMS, [])).toEqual([]);
    });
});

// ─── factsPacket ────────────────────────────────────────────────────────────
describe('FactsEngine.factsPacket', () => {
    test('live packet carries score, winProb, pressure and last round', () => {
        const history = [historyMatch('A', 'B', 25, 61, 50)];
        const live = liveMatch('A', 'B', 420, 380, [
            {
                roundNumber: 1,
                team1: { promise: 6, actual: 4, score: -60, blind: false },
                team2: { promise: 5, actual: 9, score: 54, blind: false },
            },
        ]);
        const p = FactsEngine.factsPacket(live, TEAMS, history.concat([live]), {
            winProbOptions: { iterations: 100, rng: mulberry32(11) },
        });
        expect(p.kind).toBe('live');
        expect(p.teams).toEqual({ t1: 'Alpha', t2: 'Bravo' });
        expect(p.score).toEqual({ t1: 420, t2: 380 });
        expect(p.pressure).toBe('critical');
        expect(p.lastRound.t1).toEqual({ promise: 6, actual: 4, score: -60, blind: false });
        expect(p.winProb.t1 + p.winProb.t2).toBeCloseTo(1);
        expect(p.matchId).toBe(String(live.id));
    });

    test('recap packet names the winner and skips winProb', () => {
        const m = historyMatch('A', 'B', 10, 61, 20);
        const p = FactsEngine.factsPacket(m, TEAMS, [m]);
        expect(p.kind).toBe('recap');
        expect(p.winner).toBe('Alpha');
        expect(p.winProb).toBeUndefined();
    });

    test('nuggets include an in-match promise-miss streak', () => {
        const live = liveMatch('A', 'B', -100, 120, [
            { roundNumber: 1, team1: { score: -40 }, team2: { score: 60 } },
            { roundNumber: 2, team1: { score: -60 }, team2: { score: 60 } },
        ]);
        const p = FactsEngine.factsPacket(live, TEAMS, [live], {
            winProbOptions: { iterations: 50, rng: mulberry32(2) },
        });
        expect(p.nuggets.some(n => n.includes('Alpha') && n.includes('2 promises in a row'))).toBe(true);
        expect(p.nuggets.length).toBeLessThanOrEqual(3);
    });
});
