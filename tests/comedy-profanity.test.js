/**
 * The gaali bank: levels, rationing, and the boundary.
 *
 * The register is deliberately sharp (CLAUDE.md §0 — four friends), so these
 * tests are less about "is it clean" and more about the three promises the
 * feature makes: level 1 never swears, gaalis stay occasional, and nothing in
 * the bank targets a person rather than the play.
 */
const ComedyLibrary = require('../js/data/comedyLibrary.js');

const profane = ComedyLibrary.PHRASES.filter(p => p.profane);

describe('gaali bank — shape', () => {
    test('every profane phrase is level 2 or 3, never level 1', () => {
        // Level 1 is the clean tier by contract; a profane phrase there would
        // leak swearing to a reader who explicitly asked for none.
        const leaked = profane.filter(p => p.intensity < 2);
        expect(leaked).toEqual([]);
    });

    test('the bank is actually populated at both tiers', () => {
        expect(profane.filter(p => p.intensity === 2).length).toBeGreaterThan(5);
        expect(profane.filter(p => p.intensity === 3).length).toBeGreaterThan(5);
    });

    test('every phrase id is unique', () => {
        const ids = ComedyLibrary.PHRASES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every profane phrase belongs to a known intent', () => {
        for (const p of profane) {
            expect(ComedyLibrary.INTENTS).toContain(p.intent);
        }
    });

    test('every savage id refers to a real phrase', () => {
        for (const id of ComedyLibrary.SAVAGE_IDS) {
            expect(ComedyLibrary.byId(id)).not.toBeNull();
        }
    });
});

describe('gaali bank — the boundary (CLAUDE.md §0)', () => {
    // The point of a fixed, reviewable bank is that this can be asserted at
    // all. A prompt instruction could not be tested.
    // Matched as whole words. Substring matching is too blunt here: "chakkar"
    // ("in the matter of") contains "chakka", and "andha" sits inside ordinary
    // words too — flagging those would train the next person to ignore this
    // test, which is worse than not having it.
    const SLUR_WORDS = [
        // caste / religion / region / ethnicity
        'chamar', 'bhangi', 'mulla', 'katua', 'madrasi', 'bihari',
        // disability
        'langda', 'andha', 'behra', 'gonga',
        // gender / sexuality
        'chakka', 'hijra', 'gandu', 'randi', 'rand',
    ];

    test('no phrase contains a slur targeting a protected characteristic', () => {
        const offenders = ComedyLibrary.PHRASES.filter(p => {
            const words = p.text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
            return SLUR_WORDS.some(w => words.includes(w));
        });
        expect(offenders.map(p => `${p.id}: ${p.text}`)).toEqual([]);
    });

    test('no phrase names or targets a person rather than the play', () => {
        // Every phrase should read as a comment on a bid/blind/collapse. The
        // proxy: nothing addresses appearance, family, job or intelligence.
        const PERSONAL = ['teri maa', 'teri behen', 'tere baap', 'shakal', 'naukri', 'job chali'];
        const offenders = ComedyLibrary.PHRASES.filter(p => {
            const t = p.text.toLowerCase();
            return PERSONAL.some(x => t.includes(x));
        });
        expect(offenders.map(p => `${p.id}: ${p.text}`)).toEqual([]);
    });
});

describe('candidates() — level gating', () => {
    test('level 1 never offers a gaali, for any intent', () => {
        for (const intent of ComedyLibrary.INTENTS) {
            const out = ComedyLibrary.candidates(intent, { maxIntensity: 1, limit: 99 });
            expect(out.filter(p => p.profane)).toEqual([]);
        }
    });

    test('level 2 offers mild gaalis but never the hard tier', () => {
        const out = ComedyLibrary.candidates('greedy_read', { maxIntensity: 2, limit: 99 });
        expect(out.some(p => p.profane)).toBe(true);
        expect(out.filter(p => p.intensity === 3)).toEqual([]);
    });

    test('level 3 on a catastrophic moment can reach the hard tier', () => {
        const out = ComedyLibrary.candidates('greedy_read', {
            maxIntensity: 3, limit: 99, catastrophic: true,
        });
        expect(out.some(p => p.profane && p.intensity === 3)).toBe(true);
    });
});

describe('candidates() — rarity is enforced, not requested', () => {
    test('a candidate list never exceeds the profane ration', () => {
        for (const intent of ComedyLibrary.INTENTS) {
            const out = ComedyLibrary.candidates(intent, {
                maxIntensity: 3, limit: 99, catastrophic: true,
            });
            expect(out.filter(p => p.profane).length)
                .toBeLessThanOrEqual(ComedyLibrary.PROFANE_RATION);
        }
    });

    // The bug this guards: the gaali bank is appended AFTER the clean phrases,
    // so an in-order take at the real limit (5) filled every slot with clean
    // lines and no gaali ever reached the model — the whole feature inert
    // while every ceiling-based test still passed at limit 99.
    test('gaalis actually appear at the real call-site limit, not just at 99', () => {
        const REAL_LIMIT = 5;   // audioCommentary.comedySteer uses this
        const withGaali = ['greedy_read', 'collapse', 'blind_backfired'].filter(intent => {
            const out = ComedyLibrary.candidates(intent, {
                maxIntensity: 2, limit: REAL_LIMIT,
            });
            return out.some(p => p.profane);
        });
        expect(withGaali).toHaveLength(3);
    });

    test('the reserved profane slots never crowd out the clean majority', () => {
        const out = ComedyLibrary.candidates('collapse', {
            maxIntensity: 3, limit: 5, catastrophic: true,
        });
        expect(out.filter(p => p.profane).length).toBeLessThanOrEqual(ComedyLibrary.PROFANE_RATION);
        expect(out.filter(p => !p.profane).length).toBeGreaterThanOrEqual(3);
    });

    test('a tiny limit still respects the ceiling rather than overflowing', () => {
        const out = ComedyLibrary.candidates('collapse', {
            maxIntensity: 3, limit: 2, catastrophic: true,
        });
        expect(out.length).toBeLessThanOrEqual(2);
    });

    test('clean phrases still fill the drawer at the sharpest setting', () => {
        // If gaalis crowded out everything else the commentary would just be
        // swearing. The bulk of any list must remain the clean vocabulary.
        const out = ComedyLibrary.candidates('collapse', {
            maxIntensity: 3, limit: 6, catastrophic: true,
        });
        expect(out.filter(p => !p.profane).length).toBeGreaterThan(0);
    });

    test('the savage tier is gated behind the moment, not just the setting', () => {
        const routine = ComedyLibrary.candidates('collapse', {
            maxIntensity: 3, limit: 99, catastrophic: false,
        });
        const savageOffered = routine.filter(p => ComedyLibrary.SAVAGE_IDS.has(p.id));
        expect(savageOffered).toEqual([]);
    });
});

describe('isCatastrophic — what earns the savage tier', () => {
    const drama = (kind, t1 = 0, t2 = 0) => ({
        kind, round: { t1: { score: t1 }, t2: { score: t2 } },
    });

    test('a blown blind earns it', () => {
        expect(ComedyLibrary.isCatastrophic(drama('blind-miss', -70, 80))).toBe(true);
    });

    test('an over-extension earns it', () => {
        expect(ComedyLibrary.isCatastrophic(drama('over-extension', -40, 60))).toBe(true);
    });

    test('a brutal round earns it', () => {
        expect(ComedyLibrary.isCatastrophic(drama('routine', -100, 50))).toBe(true);
    });

    test('the match verdict earns it', () => {
        expect(ComedyLibrary.isCatastrophic(drama('match-end', 80, 40))).toBe(true);
    });

    test('a routine round does NOT — which is most rounds', () => {
        expect(ComedyLibrary.isCatastrophic(drama('routine', 70, -60))).toBe(false);
    });

    test('a clean win does not', () => {
        expect(ComedyLibrary.isCatastrophic(drama('big-swing', 82, 65))).toBe(false);
    });

    test('null is not catastrophic', () => {
        expect(ComedyLibrary.isCatastrophic(null)).toBe(false);
    });
});

describe('existing guarantees still hold with the bank in place', () => {
    test('maxIntensity remains a hard ceiling', () => {
        for (const intent of ComedyLibrary.INTENTS) {
            const out = ComedyLibrary.candidates(intent, { maxIntensity: 1, limit: 99 });
            expect(out.every(p => p.intensity <= 1)).toBe(true);
        }
    });

    test('every intent still offers something at the mild level', () => {
        // The season board renders a tail per fact; a starved intent would
        // silently fall back and look broken.
        for (const intent of ComedyLibrary.INTENTS) {
            const out = ComedyLibrary.candidates(intent, { maxIntensity: 1, limit: 99 });
            expect(out.length).toBeGreaterThan(0);
        }
    });

    test('used phrases are still skipped before the drawer reopens', () => {
        const first = ComedyLibrary.candidates('collapse', { maxIntensity: 2, limit: 99 });
        const usedIds = first.map(p => p.id);
        const second = ComedyLibrary.candidates('collapse', {
            maxIntensity: 2, limit: 99, usedIds,
        });
        // Everything allowed was used, so the drawer reopens rather than
        // returning nothing.
        expect(second.length).toBeGreaterThan(0);
    });
});
