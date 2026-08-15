const SeasonDigest = require('../js/utils/seasonDigest.js');

// ─── Fixtures (rule-correct scores per CLAUDE.md §4) ────────────────────────
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
function match(id, t1, t2, rounds) {
    const finalScore = rounds.reduce((a, r) => ({
        team1: a.team1 + r.team1.score, team2: a.team2 + r.team2.score,
    }), { team1: 0, team2: 0 });
    return {
        id: String(id), team1Id: t1, team2Id: t2, status: 'completed',
        date: `2026-02-${String((id % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        rounds, finalScore,
        winnerId: finalScore.team1 >= finalScore.team2 ? t1 : t2,
    };
}
const TEAMS = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }];

// A team that always blinds straight after a bad round, and never otherwise.
function tiltingSeason() {
    const rounds = [];
    for (let i = 0; i < 30; i += 2) {
        // even round: Alpha misses (negative)
        rounds.push(round(i + 1, 8, 3, 4));
        // odd round: Alpha answers with a blind
        rounds.push(round(i + 2, 7, 9, 4, true, false));
    }
    return [match(1, 1, 2, rounds)];
}

describe('SeasonDigest.tilt', () => {
    test('measures the blind rate after bad rounds against after good ones', () => {
        const t = SeasonDigest.tilt(TEAMS, tiltingSeason());
        const alpha = t.byTeam.find(r => r.team === 'Alpha');

        expect(alpha).toBeDefined();
        expect(alpha.afterBadPct).toBeGreaterThan(alpha.afterGoodPct);
        expect(alpha.tiltIndex).toBe(alpha.afterBadPct - alpha.afterGoodPct);
    });

    test('reports a league-wide baseline', () => {
        const t = SeasonDigest.tilt(TEAMS, tiltingSeason());
        expect(t.league.badSample).toBeGreaterThan(0);
        expect(t.league.afterBadPct).toBeGreaterThanOrEqual(0);
        expect(t.league.afterBadPct).toBeLessThanOrEqual(100);
    });

    test('ignores teams with too few bad rounds to be meaningful', () => {
        // One short match cannot clear TILT_MIN_SAMPLE.
        const t = SeasonDigest.tilt(TEAMS, [match(1, 1, 2, [round(1, 5, 6, 4), round(2, 5, 6, 4)])]);
        expect(t.byTeam).toHaveLength(0);
        expect(t.hottest).toBeNull();
    });

    test('tiltIndex is never negative — a calm team floors at zero', () => {
        const t = SeasonDigest.tilt(TEAMS, tiltingSeason());
        for (const r of t.byTeam) expect(r.tiltIndex).toBeGreaterThanOrEqual(0);
    });

    test('only consecutive rounds within one match count as a reaction', () => {
        // Two separate matches: the last round of one must not be read as
        // provoking the first round of the next.
        const a = match(1, 1, 2, [round(1, 8, 3, 4)]);                  // Alpha ends negative
        const b = match(2, 1, 2, [round(1, 7, 9, 4, true, false)]);     // Alpha opens blind
        const t = SeasonDigest.tilt(TEAMS, [a, b]);
        expect(t.league.badSample).toBe(0);   // no in-match pair exists at all
    });
});

describe('SeasonDigest.personalities', () => {
    test('gives every qualifying team exactly one archetype with evidence', () => {
        const people = SeasonDigest.personalities(TEAMS, tiltingSeason());
        expect(people.length).toBeGreaterThan(0);
        for (const p of people) {
            expect(typeof p.archetype).toBe('string');
            expect(p.archetype.length).toBeGreaterThan(0);
            expect(typeof p.evidence).toBe('string');
            expect(p.evidence.length).toBeGreaterThan(0);
            expect(typeof p.archetypeId).toBe('string');
        }
    });

    test('skips teams without enough rounds to characterise', () => {
        const people = SeasonDigest.personalities(TEAMS, [match(1, 1, 2, [round(1, 5, 6, 4)])]);
        expect(people).toHaveLength(0);
    });

    test('traits are 0-100, or null when unmeasurable', () => {
        for (const p of SeasonDigest.personalities(TEAMS, tiltingSeason())) {
            for (const [, v] of Object.entries(p.traits)) {
                if (v === null) continue;
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        }
    });

    test('a flawless promise-keeper is recognised as such', () => {
        // Alpha meets every promise exactly.
        const rounds = Array.from({ length: 30 }, (_, i) => round(i + 1, 5, 6, 4));
        const people = SeasonDigest.personalities(TEAMS, [match(1, 1, 2, rounds)]);
        const alpha = people.find(p => p.team === 'Alpha');
        expect(alpha.archetypeId).toBe('saint');
        expect(alpha.traits.discipline).toBe(100);
    });

    test('coolHead is null when tilt could not be measured', () => {
        const rounds = Array.from({ length: 30 }, (_, i) => round(i + 1, 5, 6, 4));
        const alpha = SeasonDigest.personalities(TEAMS, [match(1, 1, 2, rounds)])
            .find(p => p.team === 'Alpha');
        // No negative rounds at all → nothing to measure a reaction against.
        expect(alpha.traits.coolHead).toBeNull();
        expect(alpha.tiltIndex).toBeNull();
    });
});

describe('build() ships both sections', () => {
    test('tilt and personalities are part of the digest', () => {
        const d = SeasonDigest.build(TEAMS, tiltingSeason());
        expect(d.tilt).toBeDefined();
        expect(Array.isArray(d.personalities)).toBe(true);
    });

    test('an empty season does not throw', () => {
        expect(() => SeasonDigest.build([], [])).not.toThrow();
        const d = SeasonDigest.build([], []);
        expect(d.personalities).toEqual([]);
        expect(d.tilt.byTeam).toEqual([]);
    });
});

describe('PersonalityCards rendering', () => {
    function render(digest) {
        jest.resetModules();
        let html = '';
        const host = { set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
        global.document = { getElementById: id => (id === 'personalityCards' ? host : null) };
        global.SeasonFacts = { digest };
        require('../js/components/personalityCards.js').mount();
        delete global.document; delete global.SeasonFacts;
        return html;
    }

    test('renders one card per personality', () => {
        const d = SeasonDigest.build(TEAMS, tiltingSeason());
        const html = render(d);
        expect((html.match(/class="pc-card"/g) || []).length).toBe(d.personalities.length);
    });

    test('omits the tilt meter for a team whose tilt is unknown', () => {
        const rounds = Array.from({ length: 30 }, (_, i) => round(i + 1, 5, 6, 4));
        const html = render(SeasonDigest.build(TEAMS, [match(1, 1, 2, rounds)]));
        expect(html).not.toMatch(/pc-tilt-verdict/);
    });

    test('renders nothing at all when the pack predates these fields', () => {
        expect(render(undefined)).toBe('');
        expect(render({})).toBe('');
    });

    test('escapes hostile team names', () => {
        const html = render({
            personalities: [{
                team: '<img src=x onerror=alert(1)>', archetype: 'X', archetypeId: 'rock',
                blurb: 'b', evidence: 'e', record: '1-0', traits: { discipline: 50 },
                tiltIndex: null,
            }],
            tilt: { league: { badSample: 0 } },
        });
        expect(html).not.toMatch(/<img/);
        expect(html).toMatch(/&lt;img/);
    });
});
