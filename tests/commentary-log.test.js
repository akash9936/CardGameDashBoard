const CommentaryLog = require('../js/utils/commentaryLog.js');

// Minimal localStorage double — the real one isn't in the Node test env.
function fakeStorage(opts = {}) {
    const map = new Map();
    return {
        map,
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            if (opts.throwOnSet) throw new Error('QuotaExceededError');
            map.set(k, String(v));
        },
        removeItem: k => map.delete(k),
    };
}

describe('CommentaryLog', () => {
    let store;

    beforeEach(() => {
        store = fakeStorage();
        CommentaryLog._setStorage(store);
        CommentaryLog.clear();
    });

    describe('append + entries', () => {
        test('stores a line and reads it back', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'Sky took the lead.' });

            const out = CommentaryLog.entries('m1');
            expect(out).toHaveLength(1);
            expect(out[0].text).toBe('Sky took the lead.');
            expect(out[0].kind).toBe('round');
            expect(out[0].round).toBe(1);
            expect(typeof out[0].at).toBe('number');
        });

        test('keeps entries oldest-first so it reads as a transcript', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'first' });
            CommentaryLog.append('m1', { kind: 'round', round: 2, text: 'second' });
            CommentaryLog.append('m1', { kind: 'round', round: 3, text: 'third' });

            expect(CommentaryLog.entries('m1').map(e => e.text))
                .toEqual(['first', 'second', 'third']);
        });

        test('persists the optional three-part narration', () => {
            CommentaryLog.append('m1', {
                kind: 'round', round: 2, text: 'what line',
                why: 'why line', next: 'next line',
            });

            const [e] = CommentaryLog.entries('m1');
            expect(e.why).toBe('why line');
            expect(e.next).toBe('next line');
        });

        test('keeps matches separate', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'match one' });
            CommentaryLog.append('m2', { kind: 'round', round: 1, text: 'match two' });

            expect(CommentaryLog.entries('m1').map(e => e.text)).toEqual(['match one']);
            expect(CommentaryLog.entries('m2').map(e => e.text)).toEqual(['match two']);
        });

        test('survives a round trip through storage (it really persists)', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'persisted' });

            // Simulate a page reload: same storage, fresh read.
            CommentaryLog._setStorage(store);
            expect(CommentaryLog.entries('m1')[0].text).toBe('persisted');
        });

        test('ignores an entry with no text', () => {
            expect(CommentaryLog.append('m1', { kind: 'round', round: 1 })).toBeNull();
            expect(CommentaryLog.entries('m1')).toHaveLength(0);
        });

        test('ignores an append with no match id', () => {
            expect(CommentaryLog.append(null, { kind: 'round', round: 1, text: 'x' })).toBeNull();
        });
    });

    describe('dedupe — re-renders and snapshot echoes must not double-log', () => {
        test('the same kind+round appends once', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'Sky took the lead.' });
            const second = CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'Sky took the lead.' });

            expect(second).toBeNull();
            expect(CommentaryLog.entries('m1')).toHaveLength(1);
        });

        test('different kinds for the same round both survive', () => {
            // The screen narration and the spoken line say different things
            // about the same round; both belong in the transcript.
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'on screen' });
            CommentaryLog.append('m1', { kind: 'spoken', round: 1, text: 'out loud' });

            expect(CommentaryLog.entries('m1').map(e => e.kind)).toEqual(['round', 'spoken']);
        });
    });

    describe('caps — an abandoned browser must not grow the key without bound', () => {
        test('keeps only the newest MAX_PER_MATCH entries', () => {
            const total = CommentaryLog.MAX_PER_MATCH + 10;
            for (let i = 1; i <= total; i++) {
                CommentaryLog.append('m1', { kind: 'round', round: i, text: `line ${i}` });
            }

            const out = CommentaryLog.entries('m1');
            expect(out).toHaveLength(CommentaryLog.MAX_PER_MATCH);
            // The oldest fell off the front; the newest is still there.
            expect(out[0].text).toBe('line 11');
            expect(out[out.length - 1].text).toBe(`line ${total}`);
        });

        test('evicts the oldest matches past MAX_MATCHES', () => {
            const total = CommentaryLog.MAX_MATCHES + 5;
            for (let i = 1; i <= total; i++) {
                CommentaryLog.append(`match-${i}`, { kind: 'round', round: 1, text: `m${i}` });
            }

            // The first-created matches are gone, the newest survive.
            expect(CommentaryLog.entries('match-1')).toHaveLength(0);
            expect(CommentaryLog.entries(`match-${total}`)).toHaveLength(1);
        });

        test('never evicts the match currently being written to', () => {
            for (let i = 1; i <= CommentaryLog.MAX_MATCHES + 3; i++) {
                CommentaryLog.append(`match-${i}`, { kind: 'round', round: 1, text: `m${i}` });
            }
            const live = `match-${CommentaryLog.MAX_MATCHES + 3}`;
            expect(CommentaryLog.entries(live)).toHaveLength(1);
        });
    });

    describe('clear', () => {
        test('clears one match, leaving the others', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'one' });
            CommentaryLog.append('m2', { kind: 'round', round: 1, text: 'two' });

            CommentaryLog.clear('m1');
            expect(CommentaryLog.entries('m1')).toHaveLength(0);
            expect(CommentaryLog.entries('m2')).toHaveLength(1);
        });

        test('clears everything when called with no id', () => {
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'one' });
            CommentaryLog.append('m2', { kind: 'round', round: 1, text: 'two' });

            CommentaryLog.clear();
            expect(CommentaryLog.entries('m1')).toHaveLength(0);
            expect(CommentaryLog.entries('m2')).toHaveLength(0);
        });
    });

    describe('degrades rather than throws', () => {
        test('no storage at all — append is a no-op, entries is empty', () => {
            CommentaryLog._setStorage(null);
            expect(CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'x' })).toBeNull();
            expect(CommentaryLog.entries('m1')).toEqual([]);
        });

        test('corrupt JSON in storage reads as empty rather than throwing', () => {
            store.map.set(CommentaryLog.STORAGE_KEY, '{not json');
            expect(CommentaryLog.entries('m1')).toEqual([]);
        });

        test('a non-object payload is ignored', () => {
            store.map.set(CommentaryLog.STORAGE_KEY, '["an","array"]');
            expect(CommentaryLog.entries('m1')).toEqual([]);
        });

        test('a write that always throws does not break the caller', () => {
            CommentaryLog._setStorage(fakeStorage({ throwOnSet: true }));
            expect(() => CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'x' }))
                .not.toThrow();
        });

        test('entries for an unknown match is empty, not undefined', () => {
            expect(CommentaryLog.entries('nope')).toEqual([]);
        });
    });

    describe('count', () => {
        test('counts what is stored for that match', () => {
            expect(CommentaryLog.count('m1')).toBe(0);
            CommentaryLog.append('m1', { kind: 'round', round: 1, text: 'a' });
            CommentaryLog.append('m1', { kind: 'spoken', round: 1, text: 'b' });
            expect(CommentaryLog.count('m1')).toBe(2);
        });
    });
});
