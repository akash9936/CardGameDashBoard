const GroqService = require('../js/services/groqService.js');

// ─── In-memory localStorage stand-in ────────────────────────────────────────
function makeStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        _dump: () => Object.fromEntries(map),
    };
}

// A fetch mock that records calls and returns a canned Groq response.
function makeFetch(line = 'What a round!', status = 200) {
    const calls = [];
    const fn = jest.fn(async (url, opts) => {
        calls.push({ url, opts });
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => ({ choices: [{ message: { content: line } }] }),
        };
    });
    fn.calls = calls;
    return fn;
}

function livePacket(overrides = {}) {
    return {
        kind: 'live', matchId: 'm1',
        teams: { t1: 'Alpha', t2: 'Bravo' },
        score: { t1: 100, t2: 80 },
        roundsPlayed: 3,
        nuggets: [],
        ...overrides,
    };
}

let storage;

beforeEach(() => {
    storage = makeStorage();
    GroqService._setStorage(storage);
    GroqService._reset();
});

describe('key management', () => {
    test('no key by default; set/clear round-trips through storage', () => {
        expect(GroqService.hasKey()).toBe(false);
        GroqService.setKey('  gsk_test123  ');
        expect(GroqService.getKey()).toBe('gsk_test123');   // trimmed
        expect(GroqService.hasKey()).toBe(true);
        GroqService.setKey(null);
        expect(GroqService.hasKey()).toBe(false);
    });

    test('storage failures are swallowed', () => {
        GroqService._setStorage({
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); },
        });
        expect(GroqService.getKey()).toBeNull();
        expect(() => GroqService.setKey('x')).not.toThrow();
    });
});

describe('commentate', () => {
    test('resolves null and never fetches without a key', async () => {
        const fetch = makeFetch();
        GroqService._setFetch(fetch);
        expect(await GroqService.commentate(livePacket())).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('sends the packet to Groq with the right shape and returns the line', async () => {
        const fetch = makeFetch('  "Bravo smell blood!"  ');
        GroqService._setFetch(fetch);
        GroqService.setKey('gsk_k');

        const line = await GroqService.commentate(livePacket());
        expect(line).toBe('Bravo smell blood!');   // trimmed, quotes stripped

        const { url, opts } = fetch.calls[0];
        expect(url).toBe(GroqService.ENDPOINT);
        expect(opts.headers.Authorization).toBe('Bearer gsk_k');
        const body = JSON.parse(opts.body);
        expect(body.model).toBe(GroqService.MODEL);
        expect(body.messages[0]).toEqual({ role: 'system', content: GroqService.SYSTEM_PROMPT });
        const sent = JSON.parse(body.messages[1].content);
        expect(sent.matchId).toBe('m1');
        expect(sent.score).toEqual({ t1: 100, t2: 80 });
    });

    test('caches live lines per matchId:roundCount — one call per round', async () => {
        const fetch = makeFetch('Line one.');
        GroqService._setFetch(fetch);
        GroqService.setKey('gsk_k');

        expect(await GroqService.commentate(livePacket())).toBe('Line one.');
        expect(await GroqService.commentate(livePacket())).toBe('Line one.');
        expect(fetch).toHaveBeenCalledTimes(1);

        // A new round is a new cache key → a new call.
        await GroqService.commentate(livePacket({ roundsPlayed: 4 }));
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('recaps persist in storage and survive a session reset', async () => {
        const fetch = makeFetch('Alpha closed it out in style.');
        GroqService._setFetch(fetch);
        GroqService.setKey('gsk_k');

        const packet = livePacket({ kind: 'recap', matchId: 'done1' });
        expect(await GroqService.commentate(packet)).toBe('Alpha closed it out in style.');
        expect(GroqService.getCachedRecap('done1')).toBe('Alpha closed it out in style.');

        // New session, no key: the cached recap still serves, no fetch.
        GroqService._reset();
        GroqService.setKey(null);
        const fetch2 = makeFetch('should not be called');
        GroqService._setFetch(fetch2);
        expect(await GroqService.commentate(packet)).toBe('Alpha closed it out in style.');
        expect(fetch2).not.toHaveBeenCalled();
    });

    test('401 resolves null and flags the key as rejected', async () => {
        GroqService._setFetch(makeFetch('', 401));
        GroqService.setKey('gsk_bad');
        expect(await GroqService.commentate(livePacket())).toBeNull();
        expect(GroqService.wasKeyRejected()).toBe(true);
    });

    test('429 resolves null without flagging the key', async () => {
        GroqService._setFetch(makeFetch('', 429));
        GroqService.setKey('gsk_k');
        expect(await GroqService.commentate(livePacket())).toBeNull();
        expect(GroqService.wasKeyRejected()).toBe(false);
    });

    test('a network error resolves null, never throws', async () => {
        GroqService._setFetch(jest.fn(async () => { throw new Error('offline'); }));
        GroqService.setKey('gsk_k');
        await expect(GroqService.commentate(livePacket())).resolves.toBeNull();
    });

    test('overlong lines are truncated', async () => {
        GroqService._setFetch(makeFetch('x'.repeat(500)));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(livePacket());
        expect(line.length).toBeLessThanOrEqual(220);
        expect(line.endsWith('…')).toBe(true);
    });

    test('match-end keeps two sentences — the win and the roast', async () => {
        GroqService._setFetch(makeFetch(
            'KorbaGang take it with 510 points.\nGaurav slash Akash never recovered from that blind. And a third one.'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(
            livePacket({ kind: 'spoken', moment: 'match-end' }), { spoken: true });
        expect(line).toBe('KorbaGang take it with 510 points. Gaurav slash Akash never recovered from that blind.');
        expect(line).not.toContain('\n');   // newlines read as a stumble aloud
    });

    test('match-start keeps two sentences', async () => {
        GroqService._setFetch(makeFetch('Alpha face Bravo tonight. History favours Alpha. Extra sentence here.'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(
            livePacket({ kind: 'spoken', moment: 'match-start' }), { spoken: true });
        expect(line).toBe('Alpha face Bravo tonight. History favours Alpha.');
    });

    test('spoken lines are trimmed to one clean sentence', async () => {
        GroqService._setFetch(makeFetch(
            'KorbaGang lands the blind for 140. It was their fourth of the night. The room went wild.'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(livePacket({ kind: 'spoken' }), { spoken: true });
        expect(line).toBe('KorbaGang lands the blind for 140.');
    });

    test('a rambling spoken line is cut at a whole word, never mid-word', async () => {
        // No sentence punctuation at all — the length guard has to do the work.
        GroqService._setFetch(makeFetch('word '.repeat(80).trim()));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(livePacket({ kind: 'spoken' }), { spoken: true });
        expect(line.length).toBeLessThanOrEqual(191);
        expect(line.endsWith('.')).toBe(true);
        expect(line).not.toMatch(/wor\.$/);   // not a chopped word
    });

    test('on-screen lines keep the longer character budget', async () => {
        GroqService._setFetch(makeFetch('x'.repeat(500)));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(livePacket());
        expect(line.length).toBeGreaterThan(191);   // not the spoken limit
        expect(line.length).toBeLessThanOrEqual(220);
    });

    test('rejects a line written in the wrong script', async () => {
        // Models often ignore "write in Devanagari" and romanise Hindi, which
        // a Hindi voice then reads with English phonetics.
        GroqService._setFetch(makeFetch('KorbaGang ne blind call kiya aur jeet gaye.'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(
            livePacket({ kind: 'spoken' }), { spoken: true, langCode: 'hi', language: 'Hindi' });
        expect(line).toBeNull();
    });

    test('accepts a line in the expected script', async () => {
        GroqService._setFetch(makeFetch('कोरबागैंग ने ब्लाइंड जीत लिया।'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(
            livePacket({ kind: 'spoken' }), { spoken: true, langCode: 'hi', language: 'Hindi' });
        expect(line).toBe('कोरबागैंग ने ब्लाइंड जीत लिया।');
    });

    test('Latin-script languages are not script-checked', async () => {
        GroqService._setFetch(makeFetch('Coke acaba de aterrizar una blind.'));
        GroqService.setKey('gsk_k');
        const line = await GroqService.commentate(
            livePacket({ kind: 'spoken' }), { spoken: true, langCode: 'es', language: 'Spanish' });
        expect(line).toBe('Coke acaba de aterrizar una blind.');
    });

    test('language and mood are appended to the spoken prompt', async () => {
        const fetch = makeFetch('कुछ।');
        GroqService._setFetch(fetch);
        GroqService.setKey('gsk_k');
        await GroqService.commentate(livePacket({ kind: 'spoken' }), {
            spoken: true, langCode: 'hi', language: 'Hindi', mood: 'Be dry and deadpan.',
        });
        const system = JSON.parse(fetch.calls[0].opts.body).messages[0].content;
        expect(system).toContain('Be dry and deadpan.');
        expect(system).toContain('Write the line in Hindi');
        expect(system).toContain('native script');
    });

    test('junk responses resolve null', async () => {
        GroqService._setFetch(jest.fn(async () => ({
            ok: true, status: 200, json: async () => ({ nope: true }),
        })));
        GroqService.setKey('gsk_k');
        expect(await GroqService.commentate(livePacket())).toBeNull();
    });

    test('recap store prunes to the 50 most recent', async () => {
        GroqService.setKey('gsk_k');
        for (let i = 0; i < 55; i++) {
            GroqService._setFetch(makeFetch(`Recap ${i}`));
            await GroqService.commentate(livePacket({ kind: 'recap', matchId: `mm${i}` }));
        }
        const stored = JSON.parse(storage.getItem('aiCommentary.recaps'));
        expect(Object.keys(stored).length).toBe(50);
        expect(stored.mm54).toBe('Recap 54');
        expect(stored.mm0).toBeUndefined();   // oldest pruned
    });
});
