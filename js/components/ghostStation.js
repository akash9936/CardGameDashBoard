/**
 * Ghost Seat — the table station (WP4).
 *
 * One laptop at the table is three things at once: the camera that photographs
 * each ghost's dealt hand, the display the table reads, and the receiver for
 * the ghost's remote shutter. Its screen faces the table; the camera preview is
 * **never mounted in the DOM** after setup, so nobody at the table can see a
 * hand on it.
 *
 * **This file is the logic half.** Everything below `logic` is pure: no DOM, no
 * `getUserMedia`, no Firestore, not even at import time. It is required
 * directly by Jest's node environment and by `node -e` smoke checks. The camera
 * stream, shutter listener, and rendering are stubbed in the marked DOM-wiring
 * section and land in phase P2.
 *
 * **Card delivery only.** The station displays no score-bearing state of any
 * kind, by design — it holds no such data. Every such call is made aloud on the
 * voice call and typed on the round form at the table (`ghost-seat.md` →
 * *Scope: card delivery only*). Nothing in this file may ever surface one, and
 * `tests/ghost-station-logic.test.js` asserts that no built string does.
 */
// In the browser `Cards` is a global from <script src="js/utils/cards.js">.
// In Node (Jest / `node -e`) require it and stash it on `globalThis` so the
// IIFE below sees `Cards` as a free identifier — the same late-bound pattern
// `js/services/ghostService.js:4-6` uses, and deliberately NOT a `const`
// captured at IIFE-eval time.
//
// Why late-bound matters here (defence in depth): §6 mandates the script order
// `cards.js` → `ghostService.js` → … → `ghostStation.js`, and WP3 owns
// `index.html`. But if this file were ever evaluated first, an eager
// `const C = Cards` would freeze `null` for the life of the page and every
// helper would *silently* degrade — `cardLabel('TS')` would print `"TS"`
// (violating "always display 10, never T") and `playLine` would drop the
// position entirely, handing the table a card announcement with no position and
// no console error. Resolving on each call means a correct load order that
// arrives late still works, and a genuinely missing dependency throws loudly at
// the call site instead of quietly printing the wrong thing.
if (typeof globalThis.Cards === 'undefined' && typeof require !== 'undefined') {
    globalThis.Cards = require('../utils/cards.js');
}

const GhostStation = (() => {
    /**
     * Resolve the card model at call time, never at load time.
     *
     * @returns {Object} The `Cards` module.
     * @throws {Error} Loudly, if `cards.js` has not loaded — a silent `null`
     *   here would corrupt card labels and drop play positions.
     */
    function cardsModule() {
        const c = (typeof Cards !== 'undefined') ? Cards : null;
        if (!c) {
            throw new Error(
                'GhostStation requires js/utils/cards.js to be loaded first '
                + '(see the script order in index.html).'
            );
        }
        return c;
    }

    /**
     * Maximum long edge, in pixels, for a captured frame before JPEG encoding.
     * `ghost-seat.md` → *Photo as base64*.
     */
    const MAX_EDGE = 1000;

    /**
     * Hard ceiling on the base64 data URL, in characters. Firestore's document
     * limit is 1 MiB; 700k characters leaves comfortable headroom for the rest
     * of the doc. Over this after the last retry, the ghost is told to retake.
     */
    const MAX_DATA_URL_CHARS = 700000;

    /** JPEG quality ladder: first attempt, then one retry, then give up. */
    const QUALITY_LADDER = [0.6, 0.45];

    /** Message the ghost sees when even the lowest quality is still too large. */
    const CAPTURE_ERROR_MESSAGE = 'Photo is too large to send — retake with more light.';

    // ─── Pure logic (testable without DOM) ─────────────────────────────────

    /**
     * HTML-escape a value for interpolation into a station string.
     *
     * **Source of truth: `escapeHtml(s)` at `js/app.js:1101`.** This is a
     * verbatim copy of its five replacements (`& < > " '`), kept local because
     * this IIFE cannot see `app.js` at load order — permitted by the
     * implementation plan §7.2, which forbids only a *different* implementation.
     * If the source of truth changes, change this with it.
     *
     * Every builder below that embeds `memberName` or `capturedBy` runs it
     * through here: those two fields are pushed to every open station and
     * dashboard, so they are escaped at this boundary regardless of what the
     * rest of the codebase does with names today.
     *
     * @param {*} s Any value; coerced to string.
     * @returns {string} Escaped text, safe to interpolate into markup.
     */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * English ordinal for a 1-based position: 1 → `'1st'`, 11 → `'11th'`.
     *
     * The teens are the whole difficulty: 11/12/13 take `th` despite ending in
     * 1/2/3, and a 13-card hand hits all three of them.
     *
     * @param {number} n A 1-based position.
     * @returns {string|null} e.g. `'5th'`, or null for non-positive/non-finite input.
     */
    function ordinal(n) {
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
        const i = Math.trunc(n);
        const lastTwo = i % 100;
        if (lastTwo >= 11 && lastTwo <= 13) return `${i}th`;
        switch (i % 10) {
            case 1: return `${i}st`;
            case 2: return `${i}nd`;
            case 3: return `${i}rd`;
            default: return `${i}th`;
        }
    }

    /**
     * Human label for a card code, `10` never `T` (`Cards.display`).
     * @param {*} code Card code.
     * @returns {string} e.g. `'Q♠'`. Falls back to the escaped raw value so a
     *   junk code is still identifiable on screen rather than vanishing.
     */
    function cardLabel(code) {
        const d = cardsModule().display(code);
        return d ? d.rank + d.suit : escapeHtml(code);
    }

    /**
     * Station-visible status of one ghost seat for one round, derived purely
     * from that seat's round doc.
     *
     * The five states and their exact boundaries:
     *
     * - `waiting-deal` — no doc at all. Nothing has happened for this seat.
     * - `captured` — a doc exists but no photo has been delivered for the
     *   current request. **This is the "hand is being shown to the camera"
     *   state**, and it is what drives the capture prompt.
     * - `entering` — the photo for the current request has landed
     *   (`capturedAt` set, no newer request outstanding) but `cards` is not yet
     *   written. The ghost is reviewing the photo and/or tapping their 13 cards.
     * - `ready` — `cards` written, `playedCards` still empty. Hand digitised,
     *   waiting for the first trick.
     * - `playing` — `playedCards` non-empty.
     *
     * **The `captured`/`entering` boundary, and why it is `capturedAt`.** From
     * Firestore alone the station cannot tell "the ghost is staring at the
     * photo deciding Accept/Retake" from "the ghost is tapping cards into the
     * grid" — the doc is byte-identical in both cases, because nothing is
     * written between Accept and confirm (`ghost-seat.md` → Screen 1:
     * *"Nothing writes to Firestore until then"*). So the boundary cannot be
     * the ghost's mental state. It is the single fact the doc does record:
     *
     *     no photo delivered  → `captured`   (the table owes a photo)
     *     photo delivered     → `entering`   (the ghost owes a hand)
     *
     * That split is also the one the table needs, because it is exactly the
     * question "is the physical player still holding this hand up to the lens?"
     * — true for precisely as long as no photo has landed. The name `captured`
     * reads as "this is the seat being captured right now", which is what the
     * prompt says out loud.
     *
     * ### Retake: the `captureRequest` / `capturedRequest` pair
     *
     * `captureRequest` counts the ghost's shutter taps; **every increment past
     * the first is a retake**. `capturedRequest` is the counter value the
     * delivered photo answered — written by `ghostService.writePhoto`
     * (`js/services/ghostService.js`) on **every** photo it stores, alongside
     * `capturedAt`. The comparison is the entire retake mechanism:
     *
     *     capturedRequest === captureRequest  → this photo is current
     *     capturedRequest !== captureRequest  → this photo does not answer the
     *                                           current request → back to
     *                                           `captured`, seat re-queues
     *
     * The `<` direction is the ordinary retake. The `>` direction is only
     * reachable through a corrupt or rolled-back write, and is treated the same
     * way deliberately: a seat wrongly left in the queue costs one redundant
     * prompt, a seat wrongly dropped from it strands the ghost.
     *
     * Without the pair the station cannot see a retake at all: the doc still
     * has a `capturedAt`, so the seat would read `entering`, drop out of
     * `captureQueue`, and the physical player — following the screen — would
     * square the fan face-down while the ghost waits on a photo that is never
     * coming. That is the failure this pair exists to prevent, so
     * `capturedRequest` is **not optional on any write this app performs**.
     *
     * **Legacy tolerance only.** The `!Number.isFinite(answered)` branch below
     * exists solely for round docs written before `capturedRequest` was added
     * (a match already in flight across a deploy). It degrades to the old
     * behaviour — "any delivered photo answers the current request" — which
     * cannot see a retake. It is a migration crutch, not a supported path, and
     * every photo written by the current `writePhoto` skips it.
     *
     * No status ever surfaces a score-bearing decision — the station holds
     * none.
     *
     * @param {Object|null|undefined} roundDoc The seat's `ghostRounds` doc.
     * @returns {'waiting-deal'|'captured'|'entering'|'ready'|'playing'}
     */
    function statusFor(roundDoc) {
        if (!roundDoc || typeof roundDoc !== 'object') return 'waiting-deal';

        const played = Array.isArray(roundDoc.playedCards) ? roundDoc.playedCards : [];
        if (played.length > 0) return 'playing';

        const hand = Array.isArray(roundDoc.cards) ? roundDoc.cards : null;
        if (hand && hand.length > 0) return 'ready';

        const request = Number(roundDoc.captureRequest) || 0;

        if (!roundDoc.capturedAt) return 'captured';

        // A photo has landed. Which request did it answer?
        const answered = Number(roundDoc.capturedRequest);
        if (!Number.isFinite(answered)) {
            // Legacy doc (pre-`capturedRequest`). Cannot detect a retake; see
            // the note above. Current writes never reach here.
            return 'entering';
        }
        // Any mismatch means this photo does not answer the current request.
        // `answered < request` is the ordinary retake. `answered > request` can
        // only come from a corrupt or rolled-back write (P2 passing a stale-high
        // value, or a `captureRequest` that regressed) — the JSDoc on
        // `watchShutter` already warns about exactly that. Treating it as
        // `entering` would drop the seat from the capture queue while the ghost
        // waits on a photo nobody is going to take, which is the same silent
        // failure the pair exists to prevent. Fail safe: keep the seat queued.
        if (answered !== request) return 'captured';

        return 'entering';
    }

    /**
     * Does this seat still owe a photo for this round?
     *
     * True whenever no photo has been delivered for the current request —
     * which includes the state at the top of every deal, where the round doc
     * does not exist yet. That absent-doc case is the important one: the
     * station must prompt the handler to show a hand *before* the ghost can
     * usefully fire the shutter, so gating the queue on a `captureRequest`
     * that only exists after the ghost taps 📷 would invert the physical order
     * and leave the table staring at an empty prompt.
     *
     * @param {Object|null|undefined} roundDoc The seat's `ghostRounds` doc.
     * @returns {boolean}
     */
    function needsCapture(roundDoc) {
        const status = statusFor(roundDoc);
        return status === 'captured' || status === 'waiting-deal';
    }

    /**
     * Display name for a seat, escaped. Falls back to a neutral label rather
     * than printing `undefined` on a screen the whole table is reading.
     * @param {Object|null|undefined} seat A `ghostSeats` entry.
     * @returns {string} Escaped name.
     */
    function seatName(seat) {
        return escapeHtml(rawSeatName(seat));
    }

    /**
     * The seat's display name **before escaping**, with the neutral fallback
     * already applied. Only `seatName` and `possessive` use it; nothing renders
     * it directly.
     *
     * @param {Object|null|undefined} seat A `ghostSeats` entry.
     * @returns {string} Raw (unescaped) name.
     */
    function rawSeatName(seat) {
        const raw = seat && seat.memberName ? String(seat.memberName) : '';
        return raw.trim() || 'this player';
    }

    /**
     * Possessive form of a seat's name: `Rahul` → `Rahul's`, `Chris` → `Chris'`.
     *
     * **Takes the seat, not an escaped string.** The `s$` rule inspects the
     * last character, so it must run on the **raw** name. Run against
     * already-escaped text it inspects the tail of an HTML entity instead: a
     * name ending in a quote escapes to `…&quot;`, whose last character is `;`,
     * so the rule appends `'s` and the station's large-type screen — which the
     * whole table reads — shows `Ross&quot;'s`. Decide on the raw character,
     * then escape.
     *
     * **The escaping regime is unchanged.** The untrusted part is `memberName`
     * and it is escaped exactly once, on one pass, before it is concatenated
     * with anything. The apostrophe (and the `s`) appended here are this
     * function's own literals — never user input — so they stay literal, the
     * same rule `ghostSeatView.overlapWarning` follows. That keeps the built
     * string readable and keeps double-escaping impossible.
     *
     * @param {Object|null|undefined} seat A `ghostSeats` entry.
     * @returns {string} Possessive with the name escaped, ready to interpolate.
     */
    function possessive(seat) {
        const raw = rawSeatName(seat);
        const escaped = escapeHtml(raw);
        return /s$/i.test(raw) ? `${escaped}'` : `${escaped}'s`;
    }

    /**
     * The human status line the station shows for one seat.
     *
     * Wording follows `ghost-seat.md` → *The table station* §2 verbatim in
     * shape:
     *   - `Showing Rahul's hand — waiting for Rahul to capture…`
     *   - `Rahul is entering his hand…`  (rendered gender-neutrally as
     *     "their hand" — the spec's example uses one player's pronoun; the app
     *     does not model gender, so "their" is the only form it can build)
     *   - `Rahul is ready`
     *
     * Carries no score-bearing state.
     *
     * @param {Object|null|undefined} seat A `ghostSeats` entry (`memberName`).
     * @param {Object|null|undefined} roundDoc The seat's `ghostRounds` doc.
     * @returns {string} Escaped, ready to interpolate.
     */
    function statusLine(seat, roundDoc) {
        const name = seatName(seat);
        switch (statusFor(roundDoc)) {
            case 'captured':
                return `Showing ${possessive(seat)} hand — waiting for ${name} to capture…`;
            case 'entering':
                return `${name} is entering their hand…`;
            case 'ready':
                return `${name} is ready`;
            case 'playing': {
                const played = Array.isArray(roundDoc.playedCards) ? roundDoc.playedCards : [];
                const left = Math.max(0, 13 - played.length);
                return `${name} is playing — ${left} ${left === 1 ? 'card' : 'cards'} left`;
            }
            case 'waiting-deal':
            default:
                return `Waiting for ${possessive(seat)} hand — the table is dealing…`;
        }
    }

    /**
     * Who took the photo, escaped, for the station's capture confirmation.
     * @param {Object|null|undefined} roundDoc The seat's `ghostRounds` doc.
     * @returns {string} Escaped line, or `''` when nobody is recorded.
     */
    function capturedByLine(roundDoc) {
        const raw = roundDoc && roundDoc.capturedBy ? String(roundDoc.capturedBy).trim() : '';
        if (!raw) return '';
        return `Photo shown by ${escapeHtml(raw)}`;
    }

    /**
     * Normalise the `ghostSeats` map (or array) into a stable, seat-key-ordered
     * list. Seat-key order is the sequencing rule for multi-ghost capture, so
     * it must not depend on object key insertion order.
     *
     * @param {Object|Array|null|undefined} seats `ghostSeats` map or array.
     * @returns {Array<Object>} Each entry carries a `seatKey`.
     */
    function seatList(seats) {
        if (!seats) return [];
        const out = Array.isArray(seats)
            ? seats.filter((s) => s && typeof s === 'object').map((s) => Object.assign({}, s))
            : Object.keys(seats).map((k) => Object.assign({ seatKey: k }, seats[k]));
        for (const s of out) if (!s.seatKey) s.seatKey = '';
        return out.sort((a, b) => String(a.seatKey).localeCompare(String(b.seatKey)));
    }

    /**
     * Firestore doc id for a seat's round doc: `{roundIndex}_{seatKey}`.
     * @param {number} roundIndex Round index.
     * @param {string} seatKey Seat key.
     * @returns {string}
     */
    function roundDocId(roundIndex, seatKey) {
        return `${roundIndex}_${seatKey}`;
    }

    /**
     * Look up a seat's round doc from whatever shape the caller holds: keyed by
     * full doc id (`0_t1_0`), or by bare seat key.
     * @param {Object|null|undefined} roundDocs Map of docs.
     * @param {string} seatKey Seat key.
     * @param {number} roundIndex Round index.
     * @returns {Object|null}
     */
    function docFor(roundDocs, seatKey, roundIndex) {
        if (!roundDocs || typeof roundDocs !== 'object') return null;
        const byId = roundDocs[roundDocId(roundIndex, seatKey)];
        if (byId) return byId;
        return roundDocs[seatKey] || null;
    }

    /**
     * The seats still owed a photo for this round, in **seat-key order**.
     *
     * Only one seat "shows" at a time: the station prompts for `queue[0]`,
     * that hand is fanned to the lens, the ghost fires the shutter, and the
     * seat drops off the queue. A retake puts it back at its seat-key position
     * rather than at the end — the physical player is already holding that
     * hand, so re-prompting for it immediately is the shortest path.
     *
     * @param {Object|Array|null|undefined} seats `ghostSeats` map or array.
     * @param {Object|null|undefined} roundDocs Round docs keyed by doc id or seat key.
     * @param {number} roundIndex Round index.
     * @returns {Array<Object>} Seats (with `seatKey`) still lacking a delivered photo.
     */
    function captureQueue(seats, roundDocs, roundIndex) {
        return seatList(seats).filter((seat) => {
            if (seat.active === false) return false;
            return needsCapture(docFor(roundDocs, seat.seatKey, roundIndex));
        });
    }

    /**
     * The prompt the physical player follows: **`Now show Priya's hand`**
     * (`ghost-seat.md` → *The table station*).
     *
     * The name is load-bearing — with three ghosts the handler is choosing
     * between three face-down packets and a bare "next seat" tells them
     * nothing. `memberName` is escaped.
     *
     * @param {Object|Array|null|undefined} seats `ghostSeats` map or array.
     * @param {Object|null|undefined} roundDocs Round docs keyed by doc id or seat key.
     * @param {number} roundIndex Round index.
     * @returns {string|null} The prompt, or null when every seat has its photo.
     */
    function capturePrompt(seats, roundDocs, roundIndex) {
        const queue = captureQueue(seats, roundDocs, roundIndex);
        if (!queue.length) return null;
        return `Now show ${possessive(queue[0])} hand`;
    }

    /**
     * What the station shows once the capture queue is empty.
     * @returns {string}
     */
    function allCapturedLine() {
        return 'All hands captured — square each fan face-down, in photo order.';
    }

    /**
     * The played-card announcement: `▶ Q♠ — 5th from the left`.
     *
     * The position is `card`'s 1-based place among the cards **still held**, in
     * photo order (`Cards.positionOf`) — the number the handler counts across
     * the face-down fan. Callers pass `playedCards` as it stands *including*
     * the card just played; the position is computed against the packet before
     * the pull, which is the packet in the handler's hand.
     *
     * > ⚠ **`playedCards` convention — inverted from `undoLine`.** `playLine`
     * > expects the array **including** `card` (i.e. the `playedCards` the
     * > service just returned from `playCard`, or the value the listener
     * > delivered *after* the write). `undoLine` expects it **before** the pop.
     * > Passing the wrong side of the write is not an error and does not throw:
     * > it silently announces a position one off, and the handler pulls the
     * > wrong card face-down into a live trick. Pass the post-write array here,
     * > the pre-write array to `undoLine`.
     *
     * @param {string} card The card just played.
     * @param {string[]|null|undefined} cardsPhotoOrder The 13 codes in photo order.
     * @param {string[]|null|undefined} playedCards Played codes, **including**
     *   `card` — the array as it stands *after* the play was written.
     * @returns {string} Announcement line.
     */
    function playLine(card, cardsPhotoOrder, playedCards) {
        const played = Array.isArray(playedCards) ? playedCards.slice() : [];
        // Exclude the card being announced so its own position is visible: the
        // handler has not pulled it yet.
        const last = played.lastIndexOf(card);
        if (last !== -1) played.splice(last, 1);

        const pos = cardsModule().positionOf(card, cardsPhotoOrder, played);
        const label = cardLabel(card);
        const ord = ordinal(pos);
        if (!ord) return `▶ ${label}`;
        return `▶ ${label} — ${ord} from the left`;
    }

    /**
     * The take-back announcement:
     * `↩ Q♠ taken back — slide it back 5th from the left`.
     *
     * The position is where the card slides back into the packet
     * (`Cards.reinsertPosition`). Callers pass `playedCards` as it stands
     * *before* the pop; `reinsertPosition` does the removal itself.
     *
     * > ⚠ **`playedCards` convention — inverted from `playLine`.** `undoLine`
     * > expects the array **before** the pop (i.e. still containing `card` —
     * > snapshot it before calling `undoLastCard`, or the listener's previous
     * > payload). `playLine` expects the array *after* its write. Handing this
     * > function the post-pop array is silent: `reinsertPosition` finds nothing
     * > to remove and announces a slot that is off by one, and the handler
     * > slides the card back into the wrong place — corrupting every subsequent
     * > position announcement for that hand.
     *
     * @param {string} card The card being taken back.
     * @param {string[]|null|undefined} cardsPhotoOrder The 13 codes in photo order.
     * @param {string[]|null|undefined} playedCards Played codes, **before** the
     *   pop — `card` must still be in it.
     * @returns {string} Announcement line.
     */
    function undoLine(card, cardsPhotoOrder, playedCards) {
        const pos = cardsModule().reinsertPosition(card, cardsPhotoOrder, playedCards);
        const label = cardLabel(card);
        const ord = ordinal(pos);
        if (!ord) return `↩ ${label} taken back`;
        return `↩ ${label} taken back — slide it back ${ord} from the left`;
    }

    /**
     * Downscale a frame so its long edge is at most `maxEdge`, preserving
     * aspect ratio. The pure half of the photo pipeline; P2 feeds the result to
     * a canvas.
     *
     * **Never upscales.** A camera that hands back a small frame stays small —
     * blowing a 640×480 frame up to 1000px would add bytes without adding a
     * single readable pixel of card face.
     *
     * @param {number} width Source width in pixels.
     * @param {number} height Source height in pixels.
     * @param {number} [maxEdge=1000] Maximum allowed long edge.
     * @returns {{width: number, height: number}} Integer target dimensions
     *   (minimum 1×1). Degenerate input yields `{width: 0, height: 0}`.
     */
    function resizeTarget(width, height, maxEdge = MAX_EDGE) {
        const w = Number(width);
        const h = Number(height);
        const cap = Number(maxEdge);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            return { width: 0, height: 0 };
        }
        if (!Number.isFinite(cap) || cap <= 0) return { width: 0, height: 0 };

        const longEdge = Math.max(w, h);
        if (longEdge <= cap) {
            // Already small enough — pass through untouched, never upscale.
            return { width: Math.round(w), height: Math.round(h) };
        }
        const scale = cap / longEdge;
        return {
            width: Math.max(1, Math.round(w * scale)),
            height: Math.max(1, Math.round(h * scale)),
        };
    }

    /**
     * The JPEG quality ladder as a pure decision, run after each encode.
     *
     * `ghost-seat.md` → *Photo as base64*: encode at q0.6; if the data URL is
     * over 700k characters retry at q0.45; if it is still over, stop and write
     * a `captureError` the ghost reads as "retake with more light". Retrying
     * further is pointless — below q0.45 a fanned hand stops being legible, so
     * more light at the table is the only real fix.
     *
     * @param {number} dataUrlLength Length in characters of the encoded data URL.
     * @param {number} [attempt=0] 0-based index into the quality ladder — the
     *   attempt that produced `dataUrlLength`.
     * @param {number} [maxChars=700000] Ceiling in characters.
     * @returns {{action: 'accept'|'retry'|'fail', quality?: number, message?: string}}
     *   `accept` — write it. `retry` — re-encode at `quality`. `fail` — surface
     *   `message` to the ghost as a `captureError`.
     */
    function chooseQuality(dataUrlLength, attempt = 0, maxChars = MAX_DATA_URL_CHARS) {
        const len = Number(dataUrlLength);
        const i = Number(attempt);
        const cap = Number.isFinite(Number(maxChars)) ? Number(maxChars) : MAX_DATA_URL_CHARS;

        if (!Number.isFinite(len) || len <= 0) {
            return { action: 'fail', message: CAPTURE_ERROR_MESSAGE };
        }
        if (len <= cap) return { action: 'accept' };

        const next = (Number.isFinite(i) ? Math.trunc(i) : 0) + 1;
        if (next < QUALITY_LADDER.length) {
            return { action: 'retry', quality: QUALITY_LADDER[next] };
        }
        return { action: 'fail', message: CAPTURE_ERROR_MESSAGE };
    }

    /**
     * The quality to encode a given attempt at.
     * @param {number} attempt 0-based attempt index.
     * @returns {number} A value from `QUALITY_LADDER`; the last rung for
     *   out-of-range input.
     */
    function qualityForAttempt(attempt) {
        const i = Math.trunc(Number(attempt));
        if (!Number.isFinite(i) || i < 0) return QUALITY_LADDER[0];
        return QUALITY_LADDER[Math.min(i, QUALITY_LADDER.length - 1)];
    }

    /**
     * The Station Setup copy — the practicalities the table needs before the
     * first deal, from `ghost-seat.md` → *The table station* and the
     * implementation plan §WP4.
     *
     * `voiceCall` is not decoration: a live call is a **stated operating
     * requirement**, because turn order, the suit led, and trick results all
     * travel by voice and the app deliberately does not model whose turn it is.
     *
     * `undoEtiquette` answers the spec's open question about a take-back that
     * arrives after the card is already on the table.
     *
     * @returns {Object<string,string>} Plain strings; the caller escapes
     *   nothing because none of these carry user input.
     */
    function setupStrings() {
        return {
            heading: 'Station setup',
            power: 'Keep the laptop plugged in, disable screen sleep, keep this tab open.',
            voiceCall: 'Keep a voice/video call running with your ghost player(s) — '
                + 'turn order travels by voice.',
            aiming: 'Aim the camera at the spot where hands will be shown, then click '
                + '"Station ready". The preview disappears for the rest of the match — '
                + 'from then on nobody at the table can see a hand on this screen.',
            ready: 'Station ready',
            undoEtiquette: 'If a taken-back card was already played to the trick, the table '
                + 'rewinds that trick by hand — same as any misplay today.',
            custody: 'Fan each hand facing the camera, then square it and keep it face-down '
                + 'in photo order. Retrieve by position only — never look.',
        };
    }

    const logic = {
        // Constants
        MAX_EDGE,
        MAX_DATA_URL_CHARS,
        QUALITY_LADDER,
        CAPTURE_ERROR_MESSAGE,
        // Escaping + text helpers
        escapeHtml,
        ordinal,
        cardLabel,
        // Seat/doc shaping
        seatList,
        roundDocId,
        docFor,
        seatName,
        rawSeatName,
        possessive,
        // Status
        statusFor,
        needsCapture,
        statusLine,
        capturedByLine,
        // Capture sequencing
        captureQueue,
        capturePrompt,
        allCapturedLine,
        // Play announcements
        playLine,
        undoLine,
        // Photo pipeline (pure half)
        resizeTarget,
        chooseQuality,
        qualityForAttempt,
        // Copy
        setupStrings,
    };

    // ─── DOM wiring (WP4-DOM, phase P2) ───────────────────────────────────
    // Stubs only. A sibling agent owns this section in P2 and fills them in.
    // Nothing here may run at import time — this module is required by Jest's
    // node environment and by the §7.3 `node -e` smoke check.

    /** TODO(P2): mount the station — resolve matchId from `?station=`, strip the
     *  `spectator-pass` body class directly, open the camera, subscribe to the
     *  seats' round docs, and render. */
    function init(/* { matchId, ghostService, container } */) { /* TODO(P2) */ }

    /** TODO(P2): request the camera via getUserMedia({video:{facingMode:'environment',
     *  width:{ideal:1920}}}) into an offscreen <video> that is NEVER added to the
     *  DOM; resolve once the stream has a frame. */
    function startCamera() { /* TODO(P2) */ }

    /** TODO(P2): show the live preview for aiming ONLY while the match has zero
     *  captures, then unmount it permanently for the match. */
    function renderSetup() { /* TODO(P2) */ }

    /** TODO(P2): grab one frame to an offscreen canvas at `logic.resizeTarget`
     *  dimensions, encode with `logic.qualityForAttempt`, and walk
     *  `logic.chooseQuality` until accept/fail. */
    function grabFrame() { /* TODO(P2) */ }

    /**
     * TODO(P2): listen to every seat's round doc; on a `captureRequest`
     * increment (debounced 1s) grab a frame and call `ghostService.writePhoto`.
     *
     * **Two contracts P2 must honour — both silent if broken:**
     *
     * 1. **Pass the request number.** `writePhoto(matchId, roundIndex, seatKey,
     *    dataUrl, capturedBy, capturedRequest)` — `capturedRequest` must be the
     *    `captureRequest` value read off the snapshot **that this frame was
     *    grabbed for**, captured into a local before the async frame grab and
     *    not re-read afterwards (the ghost may have incremented it again while
     *    the canvas encoded). It is what `logic.statusFor` compares against to
     *    see a retake; omit it or pass a stale-high value and the seat leaves
     *    the capture queue while the ghost is still waiting.
     *
     * 2. **Never silently swallow a `writePhoto` rejection.** The call is two
     *    sequential document writes and cannot be a transaction; a rejection
     *    may mean the photo landed but the round was not marked (see the
     *    partial-write contract on `writePhoto`). Retry it with the same
     *    arguments, and surface a visible failure if the retry also fails —
     *    implementation plan §8, "no silent drops". A bare
     *    `.catch(() => {})` here leaves the table with a queued seat and no
     *    explanation.
     */
    function watchShutter() { /* TODO(P2) */ }

    /** TODO(P2): paint the station screen — `logic.capturePrompt`, per-seat
     *  `logic.statusLine`, and the latest `logic.playLine` / `logic.undoLine`
     *  in large type. No score-bearing state, ever. */
    function render() { /* TODO(P2) */ }

    /** TODO(P2): optional AudioContext beep on capture-request / play / undo so
     *  the table need not watch the screen. No asset files. */
    function beep() { /* TODO(P2) */ }

    /** TODO(P2): stop the camera tracks and detach listeners on section exit. */
    function destroy() { /* TODO(P2) */ }

    return {
        init,
        startCamera,
        renderSetup,
        grabFrame,
        watchShutter,
        render,
        beep,
        destroy,
        logic,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GhostStation;
}
