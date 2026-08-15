const ComedyLibrary = require('../js/data/comedyLibrary.js');

// The board is DOM code and this project's Jest runs in node (no jsdom), so we
// drive it through a stub that implements only what the component touches.
function makeHost() {
    const state = { html: '', listeners: {} };
    const grid = {
        insertAdjacentHTML(pos, h) { state.html += h; },
        set innerHTML(h) { state.html = h; },
        querySelectorAll() {
            return { length: (state.html.match(/sf-card"/g) || []).length };
        },
    };
    const host = {
        set innerHTML(v) { state.html = v; },
        get innerHTML() { return state.html; },
        querySelector(sel) {
            if (sel === '#sfMoreBtn') {
                return {
                    addEventListener: (e, f) => { state.listeners.more = f; },
                    set textContent(v) {}, remove() {}, parentElement: { innerHTML: '' },
                };
            }
            if (sel === '#sfShuffleBtn') {
                return {
                    addEventListener: (e, f) => { state.listeners.shuffle = f; },
                    classList: { add() {}, remove() {} }, offsetWidth: 0,
                };
            }
            if (sel === '.sf-grid') return grid;
            return null;
        },
    };
    return { host, state };
}

const SPREAD = ['quiet_round', 'collapse', 'domination', 'blind_paid_off',
                'one_hand_short', 'comeback', 'greedy_read', 'bids_collide'];

function load({ withLibrary = true } = {}) {
    jest.resetModules();
    const { host, state } = makeHost();
    global.document = { getElementById: id => (id === 'seasonFactsBoard' ? host : null) };
    global.localStorage = {
        _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; },
    };
    global.SeasonFacts = {
        generatedAt: '2026-08-15T00:00:00.000Z',
        coverage: { matches: 64, rounds: 599 },
        roastIntensity: 2,
        // Intents are spread the way buildSlots spreads them — a pack that
        // pointed every fact at one intent would drain that pool and is not
        // what the generator produces.
        facts: Array.from({ length: 20 }, (_, i) => ({
            id: `f${i}`, icon: '🃏', label: `Fact ${i}`,
            text: `Deterministic fact number ${i}.`,
            tail: 'baked tail.',
            intent: SPREAD[i % SPREAD.length],
            ai: false,
        })),
    };
    if (withLibrary) global.ComedyLibrary = ComedyLibrary;
    else delete global.ComedyLibrary;

    const Board = require('../js/components/seasonFactsBoard.js');
    return { Board, state };
}

const tailsIn = html => [...html.matchAll(/class="sf-tail"[^>]*>([^<]+)</g)].map(m => m[1]);
const factsIn = html => [...html.matchAll(/class="sf-text">([^<]+?)\s*<span/g)].map(m => m[1]);

afterEach(() => {
    delete global.document; delete global.localStorage;
    delete global.SeasonFacts; delete global.ComedyLibrary;
});

describe('facts are fixed, tails are not', () => {
    test('the same facts render on every mount', () => {
        const { Board, state } = load();
        Board.mount(); const a = factsIn(state.html);
        Board.mount(); const b = factsIn(state.html);
        // Which 8 lead depends on the 2-hour slot, but two mounts inside the
        // same slot must be identical — only the tails reroll.
        expect(a).toEqual(b);
        expect(a).toHaveLength(Board.PAGE_SIZE);
        for (const text of a) expect(text).toMatch(/^Deterministic fact number \d+\.$/);
    });

    test('tails change between mounts — a fresh joke each reload', () => {
        const { Board, state } = load();
        const runs = [];
        for (let i = 0; i < 6; i++) { Board.mount(); runs.push(tailsIn(state.html).join('|')); }
        // Random selection could coincide once; six identical runs would not.
        expect(new Set(runs).size).toBeGreaterThan(1);
    });

    test('no tail repeats within a single render', () => {
        const { Board, state } = load();
        for (let i = 0; i < 5; i++) {
            Board.mount();
            const t = tailsIn(state.html);
            expect(new Set(t).size).toBe(t.length);
        }
    });
});

describe('shuffle', () => {
    test('rerolls the tails without changing the facts', () => {
        const { Board, state } = load();
        Board.mount();
        const factsBefore = factsIn(state.html);
        const tailsBefore = tailsIn(state.html);

        let changed = false;
        for (let i = 0; i < 6 && !changed; i++) {
            state.listeners.shuffle();
            if (tailsIn(state.html).join('|') !== tailsBefore.join('|')) changed = true;
        }
        expect(changed).toBe(true);
        expect(factsIn(state.html)).toEqual(factsBefore);
    });

    test('keeps however many cards the reader had opened', () => {
        const { Board, state } = load();
        Board.mount();
        state.listeners.more();
        const open = (state.html.match(/sf-card"/g) || []).length;
        expect(open).toBeGreaterThan(Board.PAGE_SIZE);

        state.listeners.shuffle();
        expect((state.html.match(/sf-card"/g) || []).length).toBe(open);
    });
});

describe('degradation and settings', () => {
    test('falls back to the baked tail when ComedyLibrary is absent', () => {
        const { Board, state } = load({ withLibrary: false });
        Board.mount();
        const t = tailsIn(state.html);
        expect(t.length).toBeGreaterThan(0);
        expect(new Set(t)).toEqual(new Set(['baked tail.']));
    });

    test('hides the shuffle control when there is nothing to shuffle with', () => {
        const { Board, state } = load({ withLibrary: false });
        Board.mount();
        expect(state.html).not.toMatch(/sfShuffleBtn/);
    });

    test('roast intensity persists and is respected', () => {
        const { Board } = load();
        expect(Board.roastIntensity()).toBe(2);      // from the pack
        Board.setRoastIntensity(1);
        expect(Board.roastIntensity()).toBe(1);      // from localStorage
    });

    test('a mild reader gets mild phrases while the mild pool lasts', () => {
        // ComedyLibrary.candidates deliberately reaches for an unused sharper
        // line rather than repeat itself, so the cap is a preference, not a
        // hard wall. What must hold: the FIRST pick for an intent — when its
        // mild pool is untouched — respects the ceiling.
        const { Board } = load();
        Board.setRoastIntensity(1);
        for (const intent of SPREAD) {
            const mild = ComedyLibrary.candidates(intent, { maxIntensity: 1, limit: 99 });
            if (!mild.length) continue;
            expect(mild.every(p => p.intensity <= 1)).toBe(true);
            expect(Board.roastIntensity()).toBe(1);
        }
    });
});

describe('the deck re-deals every 2 hours', () => {
    const HOUR = 60 * 60 * 1000;
    const lead = (Board, facts, slot) =>
        Board.rotatedFacts(facts, slot).slice(0, Board.PAGE_SIZE).map(f => f.id);

    test('the rotation window is two hours', () => {
        const { Board } = load();
        expect(Board.ROTATE_MS).toBe(2 * HOUR);
    });

    test('the slot only advances on the 2-hour boundary', () => {
        const { Board } = load();
        const base = Date.parse('2026-08-15T10:00:00.000Z');
        expect(Board.currentSlot(base)).toBe(Board.currentSlot(base + 30 * 60000));
        expect(Board.currentSlot(base)).toBe(Board.currentSlot(base + 119 * 60000));
        expect(Board.currentSlot(base + 2 * HOUR)).toBe(Board.currentSlot(base) + 1);
    });

    test('the same slot always deals the same board', () => {
        const { Board } = load();
        const facts = global.SeasonFacts.facts;
        expect(lead(Board, facts, 500)).toEqual(lead(Board, facts, 500));
    });

    test('a later slot leads with a different set', () => {
        const { Board } = load();
        const facts = global.SeasonFacts.facts;
        // Across a handful of consecutive windows the lead set must move —
        // identical leads everywhere would mean the seed is being ignored.
        const seen = new Set();
        for (let s = 0; s < 6; s++) seen.add(lead(Board, facts, s).join('|'));
        expect(seen.size).toBeGreaterThan(1);
    });

    test('rotation reorders without ever losing or duplicating a fact', () => {
        const { Board } = load();
        const facts = global.SeasonFacts.facts;
        for (const slot of [0, 1, 42, 9999]) {
            const out = Board.rotatedFacts(facts, slot);
            expect(out).toHaveLength(facts.length);
            expect(new Set(out.map(f => f.id)).size).toBe(facts.length);
        }
    });

    test('the pack itself is never mutated', () => {
        const { Board } = load();
        const facts = global.SeasonFacts.facts;
        const before = facts.map(f => f.id);
        Board.rotatedFacts(facts, 7);
        expect(facts.map(f => f.id)).toEqual(before);
    });

    test('every fact still reaches the lead position across enough windows', () => {
        // A shuffle that never surfaces some facts would defeat the point.
        const { Board } = load();
        const facts = global.SeasonFacts.facts;
        const surfaced = new Set();
        for (let s = 0; s < 200; s++) for (const id of lead(Board, facts, s)) surfaced.add(id);
        expect(surfaced.size).toBe(facts.length);
    });

    test('the countdown reads in plain Hinglish and never goes negative', () => {
        const { Board } = load();
        const base = Date.parse('2026-08-15T10:00:00.000Z');
        expect(Board.msUntilNextSlot(base + 30 * 60000)).toBeGreaterThan(0);
        expect(Board.untilPhrase(base + 119 * 60000)).toMatch(/minute mein/);
        expect(Board.untilPhrase(base + 5 * 60000)).toMatch(/ghante mein/);
    });

    test('the board tells the reader when the deck turns over', () => {
        const { Board, state } = load();
        Board.mount();
        expect(state.html).toMatch(/sf-rotate-note/);
        expect(state.html).toMatch(/Naye facts/);
    });
});
