/**
 * Key rotation — several free-tier Groq accounts, used one at a time.
 *
 * The free tier is capped per account, so one key runs out long before an
 * evening does. The contract under test: a spent key steps aside for the next
 * one, a key is only benched for its own failure, and when the whole ring is
 * exhausted the service degrades to templates exactly as it does with no key.
 */
const GroqService = require('../js/services/groqService.js');

function fakeStorage() {
    const map = new Map();
    return {
        map,
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

const KEY_STORAGE = 'aiCommentary.groqKey';

// A fetch double that answers per-key: `plan` maps a key to a status code
// (or 'ok'), so a test can say "key 1 is spent, key 2 works".
function planFetch(plan, opts = {}) {
    const calls = [];
    const fn = jest.fn(async (_url, init) => {
        const auth = init.headers.Authorization || '';
        const key = auth.replace(/^Bearer /, '');
        calls.push(key);
        const outcome = plan[key];
        if (outcome === 'ok' || outcome === undefined) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [{ message: { content: opts.line || 'A line.' } }],
                }),
            };
        }
        return {
            ok: false,
            status: outcome,
            headers: { get: h => (h === 'retry-after' ? String(opts.retryAfter ?? 60) : null) },
        };
    });
    fn.calls = calls;
    return fn;
}

const packet = (n = 1) => ({ kind: 'live', matchId: `m${n}`, roundsPlayed: n });

describe('key ring — storage and shape', () => {
    let store;
    beforeEach(() => {
        store = fakeStorage();
        GroqService._setStorage(store);
        GroqService._reset();
        GroqService.setKey(null);
    });

    test('addKey builds a ring in order', () => {
        GroqService.addKey('gsk_one');
        GroqService.addKey('gsk_two');
        GroqService.addKey('gsk_three');
        expect(GroqService.keys()).toEqual(['gsk_one', 'gsk_two', 'gsk_three']);
        expect(GroqService.keyCount()).toBe(3);
    });

    test('a duplicate key is not stacked twice', () => {
        GroqService.addKey('gsk_one');
        expect(GroqService.addKey('gsk_one')).toBe(false);
        expect(GroqService.keys()).toEqual(['gsk_one']);
    });

    test('blank input is ignored', () => {
        expect(GroqService.addKey('   ')).toBe(false);
        expect(GroqService.addKey(null)).toBe(false);
        expect(GroqService.keyCount()).toBe(0);
    });

    test('keys are trimmed on the way in', () => {
        GroqService.addKey('  gsk_padded  ');
        expect(GroqService.keys()).toEqual(['gsk_padded']);
    });

    test('removeKey drops one, leaving the rest in order', () => {
        GroqService.setKey(['a', 'b', 'c']);
        GroqService.removeKey('b');
        expect(GroqService.keys()).toEqual(['a', 'c']);
    });

    test('setKey accepts an array and replaces the whole ring', () => {
        GroqService.setKey(['a', 'b']);
        GroqService.setKey(['c']);
        expect(GroqService.keys()).toEqual(['c']);
    });

    test('setKey(null) clears everything', () => {
        GroqService.setKey(['a', 'b']);
        GroqService.setKey(null);
        expect(GroqService.keys()).toEqual([]);
        expect(GroqService.hasKey()).toBe(false);
    });

    test('a legacy single-string key still works after upgrade', () => {
        // What the previous build wrote: a bare key, not JSON.
        store.map.set(KEY_STORAGE, 'gsk_legacy');
        expect(GroqService.keys()).toEqual(['gsk_legacy']);
        expect(GroqService.hasKey()).toBe(true);
        expect(GroqService.getKey()).toBe('gsk_legacy');
    });

    test('corrupt storage reads as no keys rather than throwing', () => {
        store.map.set(KEY_STORAGE, '[not json');
        expect(GroqService.keys()).toEqual([]);
        expect(GroqService.hasKey()).toBe(false);
    });
});

describe('rotation — one key at a time', () => {
    beforeEach(() => {
        GroqService._setStorage(fakeStorage());
        GroqService._reset();
        GroqService.setKey(['k1', 'k2', 'k3']);
    });

    test('uses the first key while it works', async () => {
        const fetch = planFetch({ k1: 'ok' });
        GroqService._setFetch(fetch);

        await GroqService.commentate(packet(1));
        expect(fetch.calls).toEqual(['k1']);
    });

    test('a spent key steps aside for the next account, same request', async () => {
        const fetch = planFetch({ k1: 429, k2: 'ok' });
        GroqService._setFetch(fetch);

        const line = await GroqService.commentate(packet(1));
        expect(line).toBeTruthy();                 // the round still got a line
        expect(fetch.calls).toEqual(['k1', 'k2']); // rotated, not given up
    });

    test('a rejected key steps aside too', async () => {
        const fetch = planFetch({ k1: 401, k2: 'ok' });
        GroqService._setFetch(fetch);

        const line = await GroqService.commentate(packet(1));
        expect(line).toBeTruthy();
        expect(fetch.calls).toEqual(['k1', 'k2']);
    });

    test('walks the whole ring before giving up', async () => {
        const fetch = planFetch({ k1: 429, k2: 429, k3: 'ok' });
        GroqService._setFetch(fetch);

        const line = await GroqService.commentate(packet(1));
        expect(line).toBeTruthy();
        expect(fetch.calls).toEqual(['k1', 'k2', 'k3']);
    });

    test('a spent key is not retried on the next round', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 'ok' }));
        await GroqService.commentate(packet(1));

        // Second round: k1 is still inside its cooldown, so it is skipped.
        const fetch2 = planFetch({ k2: 'ok' });
        GroqService._setFetch(fetch2);
        await GroqService.commentate(packet(2));
        expect(fetch2.calls).toEqual(['k2']);
    });

    test('all keys spent resolves null — the caller falls back to templates', async () => {
        const fetch = planFetch({ k1: 429, k2: 429, k3: 429 });
        GroqService._setFetch(fetch);

        const line = await GroqService.commentate(packet(1));
        expect(line).toBeNull();
        expect(fetch.calls).toEqual(['k1', 'k2', 'k3']);
    });

    test('a model error does not burn the other keys', async () => {
        // 400 is the request, not the account — rotating would just repeat it.
        const fetch = planFetch({ k1: 400, k2: 'ok', k3: 'ok' });
        GroqService._setFetch(fetch);

        await GroqService.commentate(packet(1));
        expect(fetch.calls).toEqual(['k1']);
    });
});

describe('exhaustion reporting', () => {
    beforeEach(() => {
        GroqService._setStorage(fakeStorage());
        GroqService._reset();
        GroqService.setKey(['k1', 'k2']);
    });

    test('one spent key is NOT "rate limited" — the ring still has quota', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 'ok' }));
        await GroqService.commentate(packet(1));

        expect(GroqService.isRateLimited()).toBe(false);
        expect(GroqService.usableKeyCount()).toBe(1);
    });

    test('every key spent reports rate limited', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 429 }));
        await GroqService.commentate(packet(1));

        expect(GroqService.isRateLimited()).toBe(true);
        expect(GroqService.usableKeyCount()).toBe(0);
    });

    test('minutes left is the SOONEST reset in the ring', async () => {
        let t = 1_000_000;
        GroqService._setNow(() => t);
        // k1 waits 10 min, k2 waits 2 min → commentary resumes in 2.
        const fetch = jest.fn(async (_u, init) => {
            const key = (init.headers.Authorization || '').replace('Bearer ', '');
            return {
                ok: false,
                status: 429,
                headers: { get: () => (key === 'k1' ? '600' : '120') },
            };
        });
        GroqService._setFetch(fetch);
        await GroqService.commentate(packet(1));

        expect(GroqService.rateLimitMinutesLeft()).toBe(2);
        GroqService._setNow(() => Date.now());
    });

    test('all keys rejected reports rejection, not a quota pause', async () => {
        GroqService._setFetch(planFetch({ k1: 401, k2: 401 }));
        await GroqService.commentate(packet(1));

        expect(GroqService.wasKeyRejected()).toBe(true);
        // Rejected keys are broken, not waiting — this is not a cooldown.
        expect(GroqService.isRateLimited()).toBe(false);
    });

    test('one rejected key among working ones is not a global rejection', async () => {
        GroqService._setFetch(planFetch({ k1: 401, k2: 'ok' }));
        await GroqService.commentate(packet(1));

        expect(GroqService.wasKeyRejected()).toBe(false);
        expect(GroqService.usableKeyCount()).toBe(1);
    });
});

describe('keyStatuses — what the settings dialog renders', () => {
    beforeEach(() => {
        GroqService._setStorage(fakeStorage());
        GroqService._reset();
        GroqService.setKey(['k1', 'k2']);
    });

    test('reports per-key state after a rotation', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 'ok' }));
        await GroqService.commentate(packet(1));

        const [a, b] = GroqService.keyStatuses();
        expect(a.key).toBe('k1');
        expect(a.ready).toBe(false);
        expect(a.minutesLeft).toBeGreaterThan(0);
        expect(b.key).toBe('k2');
        expect(b.ready).toBe(true);
    });

    test('a fresh ring is all ready', () => {
        expect(GroqService.keyStatuses().every(s => s.ready)).toBe(true);
    });

    test('adding a key after exhaustion revives commentary', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 429 }));
        await GroqService.commentate(packet(1));
        expect(GroqService.isRateLimited()).toBe(true);

        // This is the "ask the user for another key" path.
        GroqService.addKey('k3');
        expect(GroqService.isRateLimited()).toBe(false);
        expect(GroqService.getKey()).toBe('k3');

        const fetch = planFetch({ k3: 'ok' });
        GroqService._setFetch(fetch);
        const line = await GroqService.commentate(packet(2));
        expect(line).toBeTruthy();
        expect(fetch.calls).toEqual(['k3']);
    });

    test('re-adding an existing key un-benches it', async () => {
        GroqService._setFetch(planFetch({ k1: 429, k2: 429 }));
        await GroqService.commentate(packet(1));
        expect(GroqService.usableKeyCount()).toBe(0);

        // Re-entering a key the user believes is good clears its state.
        GroqService.addKey('k1');
        expect(GroqService.usableKeyCount()).toBe(1);
        expect(GroqService.getKey()).toBe('k1');
    });
});
