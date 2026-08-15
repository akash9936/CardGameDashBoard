const ComedyLibrary = require('../js/data/comedyLibrary.js');
const CommentaryMemory = require('../js/utils/commentaryMemory.js');
const FactsEngine = require('../js/utils/factsEngine.js');

const TEAMS = [{ id: 1, name: 'Coke' }, { id: 2, name: 'Sprite' }];

const liveMatch = (t1, t2, overrides = {}) => ({
    id: 'cl1', team1Id: 1, team2Id: 2, status: 'in_progress',
    rounds: [{ roundNumber: 1, team1: t1, team2: t2 }],
    finalScore: { team1: t1.score, team2: t2.score },
    ...overrides,
});

describe('ComedyLibrary structure', () => {
    test('every declared intent has phrases to draw from', () => {
        for (const intent of ComedyLibrary.INTENTS) {
            expect(ComedyLibrary.candidates(intent).length).toBeGreaterThan(0);
        }
    });

    test('phrase ids are unique', () => {
        const ids = ComedyLibrary.PHRASES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every phrase declares a known intent and a 1-3 intensity', () => {
        for (const p of ComedyLibrary.PHRASES) {
            expect(ComedyLibrary.INTENTS).toContain(p.intent);
            expect([1, 2, 3]).toContain(p.intensity);
            expect(p.text.trim().length).toBeGreaterThan(0);
        }
    });

    test('candidates never returns the whole library', () => {
        const c = ComedyLibrary.candidates('collapse', { limit: 3 });
        expect(c.length).toBeLessThanOrEqual(3);
    });

    // The season pack names intents differently to dramaOf. A missing alias is
    // invisible in the UI — the board just falls back to its baked tail — so it
    // has to be caught here.
    test('every season-pack intent resolves to phrases', () => {
        const pack = require('../js/data/seasonFacts.js');
        const facts = pack.FACTS || pack.facts || [];
        expect(facts.length).toBeGreaterThan(0);

        const demand = {};
        for (const f of facts) {
            const i = f.intent || 'quiet_round';
            demand[i] = (demand[i] || 0) + 1;
        }
        for (const [intent, needed] of Object.entries(demand)) {
            // Even the mildest reader must get a distinct tail per fact.
            const available = ComedyLibrary
                .candidates(intent, { maxIntensity: 1, limit: 99 }).length;
            expect({ intent, available }).toEqual({ intent, available: expect.any(Number) });
            expect(available).toBeGreaterThanOrEqual(needed);
        }
    });
});

describe('ComedyLibrary.intentFor — the engine picks the situation', () => {
    const intentOf = (t1, t2, overrides) =>
        ComedyLibrary.intentFor(
            FactsEngine.dramaOf(liveMatch(t1, t2, overrides), null, [], TEAMS));

    test('a blind routes on whether it landed', () => {
        expect(intentOf({ promise: 7, actual: 9, score: 140, blind: true },
                        { promise: 5, actual: 4, score: -50 })).toBe('blind_paid_off');
        expect(intentOf({ promise: 7, actual: 3, score: -70, blind: true },
                        { promise: 6, actual: 10, score: -60 })).toBe('blind_backfired');
    });

    // The distinction the season data forced: 7 of 8 over-extensions happened
    // because the opponent collapsed, not because anyone got greedy.
    test('over-extension blames the cards when the opponent collapsed', () => {
        expect(intentOf({ promise: 4, actual: 9, score: -40 },
                        { promise: 6, actual: 4, score: -60 })).toBe('cursed_hand');
    });

    test('over-extension blames the read when the opponent made their bid', () => {
        expect(intentOf({ promise: 4, actual: 9, score: -40 },
                        { promise: 4, actual: 4, score: 40 })).toBe('greedy_read');
    });

    test('a routine round splits on whether anyone reached', () => {
        expect(intentOf({ promise: 5, actual: 6, score: 51 },
                        { promise: 6, actual: 7, score: 61 })).toBe('quiet_round');
    });

    test('match-start has no comedy intent — it is scene-setting', () => {
        const start = FactsEngine.matchStartMoment(
            { id: 'x', team1Id: 1, team2Id: 2, status: 'in_progress', rounds: [] }, TEAMS, []);
        expect(ComedyLibrary.intentFor(start)).toBeNull();
    });

    test('an unknown or absent drama yields no intent', () => {
        expect(ComedyLibrary.intentFor(null)).toBeNull();
        expect(ComedyLibrary.intentFor({ kind: 'not-a-real-kind' })).toBeNull();
    });
});

describe('ComedyLibrary.candidates — intensity and exhaustion', () => {
    test('roastIntensity caps how hard the phrases bite', () => {
        const mild = ComedyLibrary.candidates('collapse', { maxIntensity: 1, limit: 99 });
        expect(mild.every(p => p.intensity === 1)).toBe(true);

        const savage = ComedyLibrary.candidates('collapse', { maxIntensity: 3, limit: 99 });
        expect(savage.length).toBeGreaterThan(mild.length);
    });

    test('used phrases are excluded', () => {
        const all = ComedyLibrary.candidates('one_hand_short', { limit: 99 });
        const first = all[0].id;
        const rest = ComedyLibrary.candidates('one_hand_short', { usedIds: [first], limit: 99 });
        expect(rest.map(p => p.id)).not.toContain(first);
    });

    // maxIntensity is a hard ceiling. Exhausting the mild pool must NOT
    // escalate — a listener who asked for mild humour would otherwise be
    // served a sharper line without ever choosing it.
    test('exhausting an intensity never escalates past the ceiling', () => {
        const mildIds = ComedyLibrary.candidates('collapse', { maxIntensity: 1, limit: 99 })
            .map(p => p.id);
        const next = ComedyLibrary.candidates('collapse', {
            maxIntensity: 1, usedIds: mildIds, limit: 99,
        });
        expect(next.length).toBeGreaterThan(0);
        expect(next.every(p => p.intensity <= 1)).toBe(true);
    });

    test('when genuinely everything is used it reopens rather than going silent', () => {
        const allIds = ComedyLibrary.PHRASES
            .filter(p => p.intent === 'match_point').map(p => p.id);
        const next = ComedyLibrary.candidates('match_point', { usedIds: allIds, limit: 99 });
        expect(next.length).toBeGreaterThan(0);
    });
});

describe('CommentaryMemory — anti-repetition without model memory', () => {
    beforeEach(() => CommentaryMemory._reset());

    // A real match is ~8 rounds, but one intent rarely fires every round. Draw
    // as many as the pool actually holds and require all of them distinct.
    test('a phrase is never offered twice while the pool lasts', () => {
        const poolSize = ComedyLibrary
            .candidates('blind_paid_off', { maxIntensity: 2, limit: 99 }).length;
        expect(poolSize).toBeGreaterThan(3);

        const picks = [];
        for (let i = 0; i < poolSize; i++) {
            const used = CommentaryMemory.state('m1').usedPhraseIds;
            const [pick] = ComedyLibrary.candidates('blind_paid_off', {
                usedIds: used, maxIntensity: 2, limit: 5,
            });
            picks.push(pick.id);
            CommentaryMemory.record('m1', { phraseId: pick.id, intent: 'blind_paid_off' });
        }
        expect(new Set(picks).size).toBe(poolSize);
    });

    // With 5 forms and a short buffer, every unused form ties as "oldest" and
    // the tie resolves to the first in the list — starving the tail shape.
    test('form rotation reaches every shape, not just the first few', () => {
        const seen = [];
        for (let i = 0; i < 12; i++) {
            const f = CommentaryMemory.nextForm('m1', ComedyLibrary.forms());
            seen.push(f.id);
            CommentaryMemory.record('m1', { form: f.id });
        }
        expect(new Set(seen).size).toBe(ComedyLibrary.forms().length);
    });

    test('openings are compared loosely so punctuation and case do not fool it', () => {
        expect(CommentaryMemory.openingOf('Arre bhai! Coke ne blind mara.'))
            .toBe(CommentaryMemory.openingOf('arre bhai, phir se'));
    });

    test('recent openings are exposed so the next line can avoid them', () => {
        CommentaryMemory.record('m1', { line: 'Arre bhai, blind chala gaya.' });
        expect(CommentaryMemory.state('m1').recentOpenings).toContain('arre bhai');
    });

    test('ledgers are per match — one match cannot exhaust another', () => {
        CommentaryMemory.record('m1', { phraseId: 'cl01' });
        expect(CommentaryMemory.hasUsed('m1', 'cl01')).toBe(true);
        expect(CommentaryMemory.hasUsed('m2', 'cl01')).toBe(false);
    });

    test('forget clears one match without touching the rest', () => {
        CommentaryMemory.record('m1', { phraseId: 'cl01' });
        CommentaryMemory.record('m2', { phraseId: 'cl02' });
        CommentaryMemory.forget('m1');
        expect(CommentaryMemory.hasUsed('m1', 'cl01')).toBe(false);
        expect(CommentaryMemory.hasUsed('m2', 'cl02')).toBe(true);
    });

    test('recording nothing useful does not pollute the ledger', () => {
        CommentaryMemory.record('m1', {});
        const s = CommentaryMemory.state('m1');
        expect(s.usedPhraseIds).toEqual([]);
        expect(s.recentForms).toEqual([]);
        expect(s.recentOpenings).toEqual([]);
    });
});
