/**
 * Ghost Seat — the ghost's own screen (WP5 + WP6 + WP7), pure logic half.
 *
 * One screen that changes state across a deal:
 *
 *     WAITING_CAPTURE → PHOTO_REVIEW → ENTER → ARRANGE → PLAY
 *                       (Accept/Retake)
 *
 * **Card delivery only.** This module carries no score-bearing decision of any
 * kind. Those are called aloud on the voice call and typed at the table on the
 * round form, exactly as they are for a player sitting across the table — see
 * `ghost-seat.md` → *Scope: card delivery only*. There is no declare screen and
 * no photo gate: the photo renders the moment it arrives. This file holds no
 * such state, and an automated check asserts it never will.
 *
 * **Pure module — no DOM, no Firestore, not even at import time.** Every
 * decision lives in `logic` as a reducer over plain data, so Jest's node
 * environment can drive the whole state machine without a browser. The reducer
 * never performs I/O: it returns *effects* (`{type, ...}`) describing the
 * service calls the DOM layer should make. That keeps "what should happen" unit
 * testable and leaves "make it happen" to the wiring below.
 *
 * Two authorities meet here and must not be confused:
 *
 * - **Photo order** — `cards`, as entered left→right from the photo. This is
 *   the physical order of the face-down packet, and the *only* order the
 *   station's "5th from the left" announcements may use. It is server state.
 * - **Display order** — how the ghost arranged the hand on their own screen.
 *   Pure cosmetics, `localStorage` only, and never sent anywhere. A corrupt or
 *   stale stored order can never lose or invent a card; see `mergeDisplayOrder`.
 */
// Cross-environment dependency lookup: a plain <script> tag in the browser (no
// bundler, no ES modules) but a `require` under Jest/node. Stashed on
// `globalThis` so the IIFE below sees `Cards` as a free identifier — the same
// late-bound pattern `js/services/ghostService.js:4-6` uses, and deliberately
// NOT a `const` captured at IIFE-eval time.
//
// Why late-bound matters (defence in depth): §6 mandates the script order
// `cards.js` → … → `ghostSeatView.js`, and WP3 owns `index.html`. But if this
// file were ever evaluated first, an eager `const C = Cards` would freeze
// `null` for the life of the page, and every guard below that reads `if (!C)`
// would *silently* fall through — `toggle` would accept nothing, `confirm`
// would skip validation, `play` would refuse every card — with no console
// error. Resolving on each call means a late-but-correct load order still
// works, and a genuinely missing dependency throws loudly at the call site.
if (typeof globalThis.Cards === 'undefined' && typeof require !== 'undefined') {
    globalThis.Cards = require('../utils/cards.js');
}

const GhostSeatView = (() => {
    /**
     * Resolve the card model at call time, never at load time.
     *
     * @returns {Object} The `Cards` module.
     * @throws {Error} Loudly, if `cards.js` has not loaded — a silent `null`
     *   here would turn every card guard in the reducer into a no-op.
     */
    function cardsModule() {
        const c = (typeof Cards !== 'undefined') ? Cards : null;
        if (!c) {
            throw new Error(
                'GhostSeatView requires js/utils/cards.js to be loaded first '
                + '(see the script order in index.html).'
            );
        }
        return c;
    }

    /** Screen states, in the order a deal moves through them. */
    const SCREENS = {
        WAITING_CAPTURE: 'WAITING_CAPTURE',
        PHOTO_REVIEW: 'PHOTO_REVIEW',
        ENTER: 'ENTER',
        ARRANGE: 'ARRANGE',
        PLAY: 'PLAY',
    };

    /** Cards in a hand. Fixed by the deal, not a tunable. */
    const HAND_SIZE = 13;

    /**
     * HTML-escaping for values rendered into markup.
     *
     * Local copy of `escapeHtml` at **`js/app.js:1101` — the source of truth**;
     * the same five replacements, kept here only because this IIFE cannot see
     * that function at script-load order. Do not let the two drift.
     *
     * @param {*} s Value to escape.
     * @returns {string}
     */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── Pure logic (testable without DOM) ─────────────────────────────────
    const logic = {
        SCREENS,
        HAND_SIZE,
        escapeHtml,

        /**
         * A fresh local state for one seat at one round index.
         *
         * "Local" means everything the ghost has done that Firestore does not
         * know about yet: which cards they have tapped into the entry tray,
         * whether they accepted the photo, and their cosmetic display order.
         * Anything the server owns (`cards`, `playedCards`, `capturedAt`) is
         * read from the round doc at `deriveState` time, never mirrored here.
         *
         * @param {Object} [init]
         * @param {number} [init.roundIndex] Deal this state belongs to.
         * @param {string[]} [init.entry] Pre-seeded entry tray (Fix hand).
         * @param {string[]} [init.displayOrder] Cosmetic order from localStorage.
         * @returns {Object} New local state.
         */
        initialState({ roundIndex = 0, entry = [], displayOrder = [] } = {}) {
            return {
                roundIndex,
                // Entry tray, in tap order === photo order. Never sorted.
                entry: entry.slice(),
                // Cosmetic hand order. localStorage only; never sent anywhere.
                displayOrder: displayOrder.slice(),
                // Photo accepted for the current `captureSeq`?
                photoAccepted: false,
                // `captureRequest` value the acceptance above refers to, so a
                // retake's increment invalidates it without extra bookkeeping.
                acceptedSeq: null,
                // Re-opened ENTER over an already-confirmed hand (Fix hand).
                fixing: false,
                // Transient, for the DOM to surface. Never blocks anything.
                warning: null,
            };
        },

        /**
         * Which screen the ghost should be looking at.
         *
         * Firestore is authoritative and this is a pure function of it plus the
         * local tray, which is what makes the view self-healing: a listener
         * update, a refresh, or a phone that slept mid-round all converge on
         * the same screen. In particular a **missing round doc is not an error
         * state** — when the table submits the round the docs are deleted, and
         * the honest answer for the next deal is "waiting for your hand".
         *
         * @param {Object|null} roundDoc The `ghostRounds` doc, or null/undefined
         *   when it does not exist (not yet created, or cleaned up).
         * @param {Object} localState From `initialState`.
         * @returns {string} A `SCREENS` value.
         */
        deriveState(roundDoc, localState) {
            const local = localState || logic.initialState();
            const doc = roundDoc || null;

            // No doc: nothing has been captured for this deal (or the round was
            // submitted and swept). Wait for the next hand — never blank, never
            // an error.
            if (!doc || !doc.capturedAt) return SCREENS.WAITING_CAPTURE;

            // A retake increments `captureRequest`; an acceptance recorded
            // against an older sequence no longer applies to this photo.
            const seq = logic.captureSeq(doc);
            const accepted = local.photoAccepted && local.acceptedSeq === seq;
            if (!accepted) return SCREENS.PHOTO_REVIEW;

            // Explicitly re-opened entry over a confirmed hand.
            if (local.fixing) return SCREENS.ENTER;

            const cards = Array.isArray(doc.cards) ? doc.cards : null;
            if (!cards || cards.length !== HAND_SIZE) return SCREENS.ENTER;

            // Hand is confirmed. Once a card has been played the ghost is in
            // the flow of the round; before that they are still arranging.
            const played = Array.isArray(doc.playedCards) ? doc.playedCards : [];
            return played.length > 0 ? SCREENS.PLAY : SCREENS.ARRANGE;
        },

        /**
         * The capture sequence a photo belongs to.
         *
         * `captureRequest` counts shutter fires: each retake increments it, so
         * it doubles as the identity of "which photo am I looking at".
         *
         * @param {Object|null} roundDoc
         * @returns {number}
         */
        captureSeq(roundDoc) {
            const n = roundDoc && roundDoc.captureRequest;
            return typeof n === 'number' && isFinite(n) ? n : 0;
        },

        // ─── Reducer ───────────────────────────────────────────────────────

        /**
         * The state machine. **Pure**: `state` is never mutated — every branch
         * builds a new object — and no I/O happens here. Service calls are
         * described as declarative effects for the DOM layer to execute:
         *
         * **Effects → service calls.** Every effect maps to exactly one call.
         * This table is the contract the DOM layer implements; there is no
         * other mapping, and an effect with no executor is a bug (the DOM would
         * change locally while the server kept stale state):
         *
         * | Effect | Executor |
         * |---|---|
         * | `{type:'requestCapture'}` | `ghostService.requestCapture(matchId, roundIndex, seatKey)` — fire the station's remote shutter. |
         * | `{type:'clearCards'}` | **`ghostService.clearHand(matchId, roundIndex, seatKey)`** — invalidate a confirmed hand (retake after confirm). Writes `{cards: null, confirmedAt: null}`. It **rejects while `playedCards` is non-empty** — the reducer's `retake` guard should have stopped that already, so treat a rejection here as the backstop firing and surface its message verbatim. `confirmHand` cannot do this job — it only accepts a full 13. |
         * | `{type:'confirmHand', cards}` | `ghostService.confirmHand(matchId, roundIndex, seatKey, cards)` — write 13 codes **in entry order**. |
         * | `{type:'playCard', card}` | `ghostService.playCard(matchId, roundIndex, seatKey, card)` — append to `playedCards`. |
         * | `{type:'undoLastCard'}` | `ghostService.undoLastCard(matchId, roundIndex, seatKey)` — pop the last `playedCards` entry. |
         * | `{type:'saveDisplayOrder', order}` | `localStorage` only (`cg.ghost.<matchId>.<seatKey>.order`) — **never a service call**. |
         *
         * A `retake` after confirm emits `requestCapture` **and** `clearCards`.
         * Both must be executed; running only the first leaves the server
         * holding a hand for a photo that no longer exists, and the station
         * keeps announcing positions computed against it. Once a card has been
         * played `retake` emits **nothing at all** and returns a warning instead
         * — see `retakeBlockedBy`, and the guard in the `retake` case.
         *
         * Unknown actions and disallowed transitions are no-ops returning the
         * same state and no effects, so an out-of-date DOM handler can never
         * push the model somewhere illegal.
         *
         * > ⚠ **`action.doc` is required, and its absence is silent.** These
         * > actions guard against server truth and **no-op without it**:
         * > `acceptPhoto`, `retake`, `sort`, `reorder`, `play`, `undoLastCard`,
         * > `fixHand`. Passing no `doc` does not throw — the reducer returns the
         * > same state and no effects, so the UI simply appears not to respond.
         * > Always pass the round doc the listener last delivered.
         *
         * @param {Object} state Local state (from `initialState`).
         * @param {Object} action `{type, ...payload}`. `action.doc` carries the
         *   current round doc where a guard needs server truth — see above.
         * @returns {{state: Object, effects: Object[]}}
         */
        reduce(state, action) {
            const s = state || logic.initialState();
            const a = action || {};
            const doc = a.doc || null;
            const noop = { state: s, effects: [] };

            switch (a.type) {
                // ── WP5: capture loop ──────────────────────────────────────
                case 'requestCapture':
                    // From WAITING_CAPTURE. Fires the shutter; nothing local
                    // changes because the photo's arrival is what advances us.
                    return {
                        state: { ...s, warning: null },
                        effects: [{ type: 'requestCapture' }],
                    };

                case 'acceptPhoto': {
                    // Bind the acceptance to this photo's sequence so a later
                    // retake invalidates it automatically.
                    if (!doc || !doc.capturedAt) return noop;
                    return {
                        state: {
                            ...s,
                            photoAccepted: true,
                            acceptedSeq: logic.captureSeq(doc),
                            warning: null,
                        },
                        effects: [],
                    };
                }

                case 'retake': {
                    // Re-fires the shutter and **throws away entry progress** —
                    // the new photo may show a different fan, so cards entered
                    // against the old one cannot be trusted. If a hand was
                    // already confirmed, the server copy is stale too and must
                    // be cleared, or the station would announce positions from
                    // a photo that no longer exists.
                    //
                    // ⚠ **Guarded, mid-play.** `clearHand` refuses to clear a
                    // confirmed hand once cards have been played (zeroing play
                    // history would mis-address every remaining position). The
                    // reducer must therefore refuse *first*: resetting local
                    // state on a clear the server will reject drops the ghost to
                    // PHOTO_REVIEW, where neither `↩ Undo last card` nor
                    // **Fix hand** — the only two controls that can resolve it —
                    // is on screen, and accepting the replacement photo lands
                    // back on PLAY with the stale hand still confirmed. Refuse,
                    // stay on PLAY, and name the way out. See `retakeBlockedBy`.
                    const blocked = logic.retakeBlockedBy(doc);
                    if (blocked) return { state: { ...s, warning: blocked }, effects: [] };

                    const confirmed = Array.isArray(doc && doc.cards)
                        && doc.cards.length > 0;
                    const effects = [{ type: 'requestCapture' }];
                    if (confirmed) effects.push({ type: 'clearCards' });
                    return {
                        state: {
                            ...s,
                            entry: [],
                            displayOrder: [],
                            photoAccepted: false,
                            acceptedSeq: null,
                            fixing: false,
                            warning: null,
                        },
                        effects,
                    };
                }

                // ── WP6: entry screen ──────────────────────────────────────
                case 'toggle': {
                    // Tap on a card, either in the 52-grid or in the entry tray.
                    //
                    // Decision (documented, and what the DOM must honour): a
                    // card already entered is **dimmed and untappable in the
                    // grid**, so a grid tap on it is a no-op; removal happens
                    // by tapping it **in the tray**. `source` says which surface
                    // the tap came from rather than letting the reducer guess,
                    // which is what makes duplicates structurally impossible —
                    // no code path can append a card the tray already holds.
                    //
                    // ⚠ CONTRACT FOR THE DOM LAYER: **removal requires
                    // `source:'tray'`.** `{type:'toggle', card}` with no
                    // `source` (or `source:'grid'`) on a card already in the
                    // tray is a **silent no-op** — it does not throw and does
                    // not remove. A tray tap wired without `source:'tray'`
                    // therefore looks dead: the ghost taps their mis-entered
                    // card and nothing happens. Tray handlers must pass
                    // `source: 'tray'`; grid handlers may omit it.
                    if (!cardsModule().isValidCode(a.card)) return noop;
                    const source = a.source === 'tray' ? 'tray' : 'grid';
                    const at = s.entry.indexOf(a.card);

                    if (at !== -1) {
                        if (source !== 'tray') return noop;   // dimmed in grid
                        const entry = s.entry.slice();
                        entry.splice(at, 1);
                        return { state: { ...s, entry, warning: null }, effects: [] };
                    }

                    // Never exceed a hand: a 14th tap has nowhere to go, which
                    // is half of why a 14-card confirm is unreachable.
                    if (s.entry.length >= HAND_SIZE) return noop;
                    return {
                        state: { ...s, entry: s.entry.concat([a.card]), warning: null },
                        effects: [],
                    };
                }

                case 'undoLast': {
                    if (!s.entry.length) return noop;
                    return {
                        state: { ...s, entry: s.entry.slice(0, -1), warning: null },
                        effects: [],
                    };
                }

                case 'confirm': {
                    // The 13-lock. The only producer of a `confirmHand` effect,
                    // and it refuses anything but a full, valid hand — so a 12-
                    // or 14-card confirm cannot be reached from the reducer at
                    // all, regardless of what the DOM does.
                    if (s.entry.length !== HAND_SIZE) return noop;
                    if (!cardsModule().validateHand(s.entry).ok) return noop;
                    const cards = s.entry.slice();   // entry order === photo order
                    const warning = logic.overlapWarning(cards, a.otherSeats);
                    return {
                        state: {
                            ...s,
                            fixing: false,
                            // Reconcile any cosmetic order against the hand just
                            // confirmed, so Arrange opens on a sane layout.
                            displayOrder: logic.mergeDisplayOrder(s.displayOrder, cards),
                            warning,
                        },
                        // The warning never blocks: the photo is the truth and
                        // the humans resolve a clash between two hands.
                        effects: [{ type: 'confirmHand', cards }],
                    };
                }

                // ── WP7: arrange ───────────────────────────────────────────
                case 'sort': {
                    const cards = logic.handOf(doc);
                    if (!cards.length) return noop;
                    const order = logic.applySort(
                        logic.mergeDisplayOrder(s.displayOrder, cards),
                        a.mode
                    );
                    return {
                        state: { ...s, displayOrder: order },
                        effects: [{ type: 'saveDisplayOrder', order }],
                    };
                }

                case 'reorder': {
                    const cards = logic.handOf(doc);
                    if (!cards.length) return noop;
                    const base = logic.mergeDisplayOrder(s.displayOrder, cards);
                    const order = logic.reorder(base, a.fromIndex, a.toIndex);
                    return {
                        state: { ...s, displayOrder: order },
                        effects: [{ type: 'saveDisplayOrder', order }],
                    };
                }

                // ── WP7: play ──────────────────────────────────────────────
                case 'play': {
                    // Only a card still physically in the packet can be played.
                    // Checked against server truth (`cards` minus `playedCards`),
                    // so playing an unheld or already-played card is unreachable
                    // no matter what the DOM hands us.
                    if (!doc) return noop;
                    const remaining = cardsModule().remainingHand(doc.cards, doc.playedCards);
                    if (remaining.indexOf(a.card) === -1) return noop;
                    return {
                        state: { ...s, warning: null },
                        effects: [{ type: 'playCard', card: a.card }],
                    };
                }

                case 'undoLastCard': {
                    // The repair path, available until the table submits the
                    // round. No countdown exists anywhere in this feature.
                    const played = (doc && Array.isArray(doc.playedCards))
                        ? doc.playedCards : [];
                    if (!played.length) return noop;
                    return {
                        state: { ...s, warning: null },
                        effects: [{ type: 'undoLastCard' }],
                    };
                }

                // ── WP7: fix hand ──────────────────────────────────────────
                case 'fixHand': {
                    // Re-open entry over a confirmed hand, seeded with the
                    // current cards so the ghost edits rather than re-enters.
                    // Permitted only while at least one card is unplayed:
                    // played cards are physically on the table and cannot be
                    // re-typed, so the ghost must undo them first.
                    if (!logic.canFixHand(doc)) return noop;
                    return {
                        state: {
                            ...s,
                            fixing: true,
                            entry: logic.handOf(doc),
                            warning: null,
                        },
                        effects: [],
                    };
                }

                case 'cancelFix':
                    if (!s.fixing) return noop;
                    return {
                        state: { ...s, fixing: false, entry: [], warning: null },
                        effects: [],
                    };

                case 'dismissWarning':
                    if (s.warning === null) return noop;
                    return { state: { ...s, warning: null }, effects: [] };

                default:
                    return noop;
            }
        },

        // ─── Guards & helpers (pure) ───────────────────────────────────────

        /**
         * The confirmed hand in photo order, defensively copied.
         * @param {Object|null} roundDoc
         * @returns {string[]} `[]` when nothing is confirmed.
         */
        handOf(roundDoc) {
            const cards = roundDoc && roundDoc.cards;
            return Array.isArray(cards) ? cards.slice() : [];
        },

        /**
         * May the ghost re-open entry to repair a digitise typo?
         *
         * Only while something is still unplayed. Once all 13 are on the table
         * there is nothing left to correct on this device — the round is over
         * bar the table's bookkeeping.
         *
         * @param {Object|null} roundDoc
         * @returns {boolean}
         */
        canFixHand(roundDoc) {
            if (!roundDoc) return false;
            const hand = Array.isArray(roundDoc.cards) ? roundDoc.cards : null;
            if (!hand || !hand.length) return false;
            return cardsModule().remainingHand(hand, roundDoc.playedCards).length > 0;
        },

        /**
         * Why a retake cannot run right now — or `null` when it can.
         *
         * The one blocking condition is the one `ghostService.clearHand`
         * enforces server-side: **a confirmed hand with cards already played.**
         * Both guards must exist. This one is primary (it stops the shutter
         * request before it fires, so the table is never made to re-show a
         * depleted fan) and the service's refusal is the backstop for any caller
         * that skips the reducer.
         *
         * **Why the message names Fix hand, not just undo.** Retake exists for
         * an *unreadable photo* (`ghost-seat.md` → Screen 0). A typo noticed
         * after play began is a *digitise* error, and the spec's repair for
         * exactly that case is on Screen 3: *"digitise typos caught late (undo,
         * **Fix hand** re-opens entry for remaining cards, re-play)"*. Fix hand
         * edits the entered codes against the photo already on the device — no
         * new shutter, no re-showing of a hand that is three cards short. So the
         * guidance leads with Fix hand and mentions undo only as the step that
         * unlocks a card that is already on the table. Retake is still reachable
         * for a genuinely unreadable photo once the plays are taken back.
         *
         * Returned as a plain string on `state.warning` — the same channel
         * `overlapWarning` uses and the DOM already renders. The card label is
         * escaped like every other value that reaches that channel.
         *
         * @param {Object|null} roundDoc The current round doc (server truth).
         * @returns {string|null} A warning naming the repair path, or null.
         */
        retakeBlockedBy(roundDoc) {
            const doc = roundDoc || null;
            if (!doc) return null;
            const hand = Array.isArray(doc.cards) ? doc.cards : null;
            if (!hand || !hand.length) return null;   // nothing confirmed to clear
            const played = Array.isArray(doc.playedCards) ? doc.playedCards : [];
            if (!played.length) return null;

            const last = played[played.length - 1];
            const d = cardsModule().display(last);
            const label = escapeHtml(d ? d.rank + d.suit : String(last));
            const n = played.length;

            return (
                `Cannot re-take the photo: ${n} card${n === 1 ? '' : 's'} `
                + `${n === 1 ? 'is' : 'are'} already on the table this round. `
                + 'To correct a mis-typed card, use **Fix hand** — it re-opens '
                + 'entry for the cards you still hold, without a new photo. '
                + `If the wrong card is one you have played, take it back first `
                + `(↩ Undo last card — ${label}). A re-take needs an empty table: `
                + 'undo every played card, then try again.'
            );
        },

        /**
         * Is the entry tray a complete, legal hand?
         * @param {Object} state
         * @returns {boolean}
         */
        canConfirm(state) {
            const s = state || {};
            if (!Array.isArray(s.entry) || s.entry.length !== HAND_SIZE) return false;
            return cardsModule().validateHand(s.entry).ok;
        },

        // ─── Multi-ghost cross-check (WP6) ─────────────────────────────────

        /**
         * Warn when two ghost hands claim the same card.
         *
         * With more than one remote seat the app can cheaply notice that two
         * confirmed hands overlap — one of them mis-entered. It **warns and
         * does not block**: the photo is the source of truth and the app cannot
         * tell which side is wrong (nor can it check against the unphotographed
         * physical hands at all). The humans resolve it against their photos.
         *
         * The other player's name is escaped here rather than at render time
         * because this string is built once and may reach several sinks; see
         * `escapeHtml` above, whose source of truth is `js/app.js:1101`.
         *
         * @param {string[]} myCards The hand about to be confirmed.
         * @param {Array<{memberName: string, cards: string[]}>} otherSeats
         *   Other seats' already-confirmed hands for this same round.
         * @returns {string|null} A warning, or null when nothing overlaps.
         */
        overlapWarning(myCards, otherSeats) {
            const mine = Array.isArray(myCards) ? myCards : [];
            const others = Array.isArray(otherSeats) ? otherSeats : [];
            if (!mine.length || !others.length) return null;

            const mineSet = new Set(mine);
            const messages = [];

            for (const seat of others) {
                if (!seat || !Array.isArray(seat.cards)) continue;
                const clash = [];
                for (const card of seat.cards) {
                    if (mineSet.has(card) && clash.indexOf(card) === -1) clash.push(card);
                }
                if (!clash.length) continue;
                const labels = clash.map((c) => {
                    const d = cardsModule().display(c);
                    return d ? d.rank + d.suit : String(c);
                });
                const name = escapeHtml(seat.memberName == null ? 'Another player' : seat.memberName);
                messages.push(
                    `${name}'s hand also claims ${labels.join(', ')} `
                    + '— one of you mis-entered; check your photos'
                );
            }

            return messages.length ? messages.join(' · ') : null;
        },

        // ─── Display order: cosmetic, localStorage only (WP7) ──────────────

        /**
         * Reconcile a stored display order against the authoritative hand.
         *
         * `displayOrder` comes from `localStorage`, which is user-writable, can
         * be stale after a Fix hand, and survives across deals. It therefore
         * gets **no trust at all**: cards it does not know about are appended in
         * photo order, cards it names that are not in the hand are dropped, and
         * duplicates collapse. The result is always a permutation of `cards` —
         * so a corrupt stored value can degrade the *arrangement* but can never
         * lose or invent a card.
         *
         * @param {*} storedOrder Whatever came out of storage.
         * @param {string[]} cards The authoritative hand, photo order.
         * @returns {string[]} A permutation of `cards`.
         */
        mergeDisplayOrder(storedOrder, cards) {
            const hand = Array.isArray(cards) ? cards : [];
            const stored = Array.isArray(storedOrder) ? storedOrder : [];

            const remaining = new Set(hand);
            const out = [];
            for (const code of stored) {
                if (!remaining.has(code)) continue;   // unknown, stale, or duplicate
                remaining.delete(code);
                out.push(code);
            }
            // Anything the stored order never mentioned keeps photo order.
            for (const code of hand) {
                if (remaining.has(code)) {
                    remaining.delete(code);
                    out.push(code);
                }
            }
            return out;
        },

        /**
         * One-tap sort preset for the Arrange screen. Cosmetic only.
         *
         * @param {string[]} displayOrder Current cosmetic order.
         * @param {string} mode `'suit'` or `'rank'`; anything else is a no-op.
         * @returns {string[]} A **new** array.
         */
        applySort(displayOrder, mode) {
            const order = Array.isArray(displayOrder) ? displayOrder.slice() : [];
            if (mode === 'suit') return cardsModule().sortBySuit(order);
            if (mode === 'rank') return cardsModule().sortByRank(order);
            return order;
        },

        /**
         * Move one card within the display order — the pure half of
         * drag-to-reorder (the Pointer Events live in the DOM layer).
         *
         * Out-of-range indices are a no-op rather than an error: a drag can end
         * anywhere, including off the edge of the strip.
         *
         * @param {string[]} displayOrder Current cosmetic order.
         * @param {number} fromIndex Card being dragged.
         * @param {number} toIndex Destination slot.
         * @returns {string[]} A **new** array; the input is not mutated.
         */
        reorder(displayOrder, fromIndex, toIndex) {
            const order = Array.isArray(displayOrder) ? displayOrder.slice() : [];
            const from = Number(fromIndex);
            const to = Number(toIndex);
            if (!Number.isInteger(from) || !Number.isInteger(to)) return order;
            if (from < 0 || from >= order.length) return order;
            if (to < 0 || to >= order.length) return order;
            if (from === to) return order;
            const [moved] = order.splice(from, 1);
            order.splice(to, 0, moved);
            return order;
        },

        /**
         * The hand as the Play screen renders it: the ghost's chosen
         * arrangement, minus what has already been played.
         *
         * Filtering rather than rewriting is what lets an undo drop the card
         * back into its arranged slot without touching `localStorage` at all.
         *
         * @param {string[]} displayOrder Cosmetic order.
         * @param {Object|null} roundDoc Round doc (server truth).
         * @returns {string[]} Cards still held, in display order.
         */
        remainingInDisplayOrder(displayOrder, roundDoc) {
            const hand = logic.handOf(roundDoc);
            const remaining = new Set(
                cardsModule().remainingHand(hand, roundDoc && roundDoc.playedCards)
            );
            const order = logic.mergeDisplayOrder(displayOrder, hand);
            return order.filter((c) => remaining.has(c));
        },

        /**
         * Has the deal moved on beneath us?
         *
         * The table submitting a round deletes that round's docs; the next deal
         * uses the next index. Local entry state belongs to exactly one deal,
         * so the DOM layer calls this to know when to start over cleanly.
         *
         * @param {Object} state Local state.
         * @param {number} roundIndex The round index now in play.
         * @returns {boolean}
         */
        isStaleRound(state, roundIndex) {
            const s = state || {};
            return Number(s.roundIndex) !== Number(roundIndex);
        },
    };

    // ─── DOM wiring (WP5/6 DOM, phase P3) ──────────────────────────────────
    // Capture loop + entry grid rendering. Intentionally empty in this phase.
    function init() { /* WP5/6 DOM — phase P3 */ }

    // ─── DOM wiring (WP7 DOM, phase P3) ────────────────────────────────────
    // Arrange (drag/sort) + Play rendering. Intentionally empty in this phase.
    function renderPlay() { /* WP7 DOM — phase P3 */ }

    return { init, renderPlay, logic };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GhostSeatView;
}
