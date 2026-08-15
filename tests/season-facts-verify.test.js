const { verifyLine, numbersIn, buildSlots, isDailyLimit,
        DEFAULT_GROQ_KEY } = require('../scripts/season-facts.js');
const SeasonDigest = require('../js/utils/seasonDigest.js');

// verifyLine is the guard that makes it safe to commit LLM prose as if it were
// data: a generated line may only contain numbers that the deterministic
// digest already computed. These tests pin that contract.

describe('numbersIn', () => {
    test('normalises thousands separators so 8,216 matches 8216', () => {
        expect(numbersIn('8,216 hands dealt')).toEqual(['8216']);
    });

    test('extracts negatives and decimals', () => {
        expect(numbersIn('averages -7.2 points')).toEqual(['-7.2']);
    });

    test('finds nothing in a line with no numbers', () => {
        expect(numbersIn('the boldest bidders in the league')).toEqual([]);
    });
});

describe('verifyLine', () => {
    const slot = {
        id: 'blind-economy',
        data: { called: 351, landed: 256, hitPct: 73, netPoints: 29190 },
        fallback: '351 blind calls have been made; 256 landed.',
    };

    test('accepts a line that only reuses numbers from the slot data', () => {
        const line = 'The league has gambled blind 351 times and got away with it 256.';
        expect(verifyLine(line, slot).ok).toBe(true);
    });

    test('accepts thousands-separated forms of a data number', () => {
        const line = 'Blind calls have paid out a net 29,190 points across the season.';
        expect(verifyLine(line, slot).ok).toBe(true);
    });

    test('rejects a number the digest never computed', () => {
        const line = 'The league has gambled blind 351 times, winning 88% of them.';
        const v = verifyLine(line, slot);
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(/invented number 88/);
    });

    test('rejects arithmetic the model did itself', () => {
        // 351 − 256 = 95 is true, but 95 is not in the packet — the model is
        // not allowed to derive, only to quote.
        const line = 'Blind calls: 351 made, 95 of them disasters.';
        expect(verifyLine(line, slot).ok).toBe(false);
    });

    test('allows the locked rule constants without them being in the data', () => {
        const line = 'A blind pays 140 when it lands and costs 70 when it does not.';
        expect(verifyLine(line, slot).ok).toBe(true);
    });

    test('rejects empty and over-long lines', () => {
        expect(verifyLine('', slot).ok).toBe(false);
        expect(verifyLine('word '.repeat(60), slot).ok).toBe(false);
    });
});

describe('isDailyLimit', () => {
    // A per-minute 429 is worth waiting out; a per-day one is not, and is the
    // only case that should interrupt the user to ask for their own key.
    test('recognises the tokens-per-day refusal Groq actually sends', () => {
        const body = JSON.stringify({ error: {
            message: 'Rate limit reached for model `llama-3.3-70b-versatile` in organization ' +
                     '`org_x` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 99497',
            code: 'rate_limit_exceeded',
        } });
        expect(isDailyLimit(body)).toBe(true);
    });

    test('recognises a requests-per-day refusal', () => {
        expect(isDailyLimit('limit reached on requests per day (RPD)')).toBe(true);
    });

    test('does NOT flag a per-minute limit as exhaustion', () => {
        expect(isDailyLimit('Rate limit reached on tokens per minute (TPM): Limit 12000')).toBe(false);
    });

    test('is safe on an empty or missing body', () => {
        expect(isDailyLimit('')).toBe(false);
        expect(isDailyLimit(null)).toBe(false);
        expect(isDailyLimit(undefined)).toBe(false);
    });
});

describe('no API key is ever committed', () => {
    // A key in a public repo is a key anyone can spend, and GitHub's secret
    // scanning rejects the push outright. The key belongs in .env, which is
    // gitignored. This test is the tripwire that stops it coming back.
    test('DEFAULT_GROQ_KEY holds no literal key', () => {
        expect(DEFAULT_GROQ_KEY).toBeNull();
    });

    test('the generator source contains no Groq key literal', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'season-facts.js'), 'utf8');
        // Groq keys are gsk_ followed by a long alphanumeric run.
        expect(src).not.toMatch(/gsk_[A-Za-z0-9]{20,}/);
    });
});

describe('buildSlots', () => {
    test('every slot ships a deterministic fallback that passes its own check', () => {
        // The fallback is what we commit when Groq is unavailable, so it must
        // never itself trip the verifier.
        const teams = [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }];
        const rounds = [1, 2, 3].map(n => ({
            roundNumber: n,
            team1: { promise: 5, actual: 6, score: 51, blind: false },
            team2: { promise: 6, actual: 7, score: 61, blind: false },
        }));
        const matches = [{
            id: '1', team1Id: 1, team2Id: 2, status: 'completed',
            date: '2026-01-01T10:00:00.000Z', rounds,
            finalScore: { team1: 153, team2: 183 }, winnerId: 2,
        }];

        const slots = buildSlots(SeasonDigest.build(teams, matches));
        expect(slots.length).toBeGreaterThan(0);
        for (const s of slots) {
            expect(verifyLine(s.fallback, s)).toEqual({ ok: true });
        }
    });

    test('skips slots whose data the season does not have yet', () => {
        const slots = buildSlots(SeasonDigest.build([], []));
        const ids = slots.map(s => s.id);
        expect(ids).not.toContain('biggest-comeback');
        expect(ids).not.toContain('top-rivalry');
    });
});
