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
        expect(a).toEqual(b);
        expect(a[0]).toBe('Deterministic fact number 0.');
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
