// In the browser `Cards` is a global from <script src="js/utils/cards.js">.
// In Node (Jest) require it and stash it on globalThis so the class below sees
// `Cards` as a free identifier — same trick matchService.js uses for `Match`.
if (typeof globalThis.Cards === 'undefined' && typeof require !== 'undefined') {
    globalThis.Cards = require('../utils/cards.js');
}

/**
 * Ghost Seat — Firestore I/O for remote seats, hands and photos (WP2).
 *
 * **Card delivery only.** This service moves a photographed hand to an absent
 * player and moves their chosen card back as a physical position. It stores no
 * score-bearing decision of any kind: the table types those at the Game Board
 * exactly as it does for an all-physical match. There is deliberately no method
 * and no field here for anything the scoreboard consumes.
 *
 * **DOM-free.** Nothing here touches `window` or `document`, at import time or
 * after, so Jest's node environment and `node -e` smoke checks can require it
 * directly. Pure decision logic lives in `GhostService.logic` and is unit-tested
 * without a Firestore at all.
 *
 * **Firebase 8.6.1 compat syntax throughout** — `db.collection(...).doc(...)`,
 * `db.runTransaction`, `db.batch()`, `firebase.firestore.FieldValue`. The site
 * has no bundler and the SDK is not being upgraded.
 *
 * Data model (implementation plan §3):
 *
 *     matches/{matchId}.ghostSeats["<teamId>_<memberIndex>"]
 *         { teamId, memberIndex, memberName, accessCode, active }
 *
 *     matches/{matchId}/ghostRounds/{roundIndex}_{seatKey}
 *         captureRequest, capturedAt, capturedBy, cards, confirmedAt,
 *         playedCards, roundIndex, seatKey
 *
 *     matches/{matchId}/ghostPhotos/{roundIndex}_{seatKey}
 *         photoData
 *
 * `roundIndex`/`seatKey` are duplicated as *fields* on the round doc because
 * Firestore has no document-ID prefix query (§10) — `subscribeToSeatRounds`
 * needs `.where('seatKey','==',…)`.
 */
const GhostService = (() => {
    /** Subcollection holding one doc per (round, seat): the hand and its plays. */
    const ROUNDS_COLLECTION = 'ghostRounds';

    /** Subcollection holding *only* photo blobs — never joined to the round doc. */
    const PHOTOS_COLLECTION = 'ghostPhotos';

    /** Parent collection of the match documents that own the two above. */
    const MATCHES_COLLECTION = 'matches';

    /**
     * Hard ceiling on a photo data URL, in characters.
     *
     * Firestore's document limit is 1 MiB; a base64 data URL past ~700k chars
     * leaves no room for the rest of the doc and signals a photo that was never
     * compressed properly. The station retries at a lower JPEG quality before
     * ever reaching this, so hitting it means "retake with more light".
     */
    const MAX_PHOTO_CHARS = 700000;

    /** Firestore's per-batch write limit. Cleanups chunk to this size. */
    const BATCH_LIMIT = 500;

    /** Most seats that may be remote — at least one player stays physical. */
    const MAX_GHOST_SEATS = 3;

    /** Seats at the table: 2 teams × 2 members. The physical-player floor. */
    const TABLE_SEATS = 4;

    // ─── Pure logic (testable with neither DOM nor Firestore) ──────────────

    const logic = {
        /**
         * Stable identity for a remote seat: team plus position in
         * `team.members`. Deliberately *not* the member's name — renaming a
         * player mid-match must not orphan their seat.
         *
         * @param {string} teamId Firestore team document id.
         * @param {number|string} memberIndex Index into `team.members`.
         * @returns {string} e.g. `'abc123_0'`.
         */
        seatKey(teamId, memberIndex) {
            return `${teamId}_${memberIndex}`;
        },

        /**
         * Document id for one seat's round: `{roundIndex}_{seatKey}`.
         *
         * Composite so a round's docs are contiguous and cleanup can address
         * them by construction rather than by query.
         *
         * @param {number|string} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @returns {string} e.g. `'0_abc123_0'`.
         */
        roundDocId(roundIndex, seatKey) {
            return `${roundIndex}_${seatKey}`;
        },

        /**
         * Validate a proposed set of ghost seats before any write.
         *
         * Two rules, both product preconditions rather than game rules: at most
         * 3 of the 4 seats may be remote (someone must deal, show hands to the
         * camera and play the ghosts' cards), and a seat cannot be listed twice.
         *
         * @param {*} seats Array of `{teamId, memberIndex, memberName}`.
         * @returns {{ok: boolean, errors: string[]}} `ok` only when empty errors.
         */
        validateSeatSelection(seats) {
            const errors = [];

            if (!Array.isArray(seats)) {
                return { ok: false, errors: ['Ghost seats must be an array.'] };
            }

            if (seats.length === 0) {
                errors.push('Select at least 1 ghost seat.');
            }

            if (seats.length > MAX_GHOST_SEATS) {
                errors.push(
                    `At most ${MAX_GHOST_SEATS} of the ${TABLE_SEATS} seats can be remote `
                    + '— at least one player must stay physical.'
                );
            }

            const seen = new Set();
            const dupes = [];
            for (const seat of seats) {
                if (!seat || typeof seat !== 'object') {
                    if (!errors.includes('Each ghost seat must be an object with teamId and memberIndex.')) {
                        errors.push('Each ghost seat must be an object with teamId and memberIndex.');
                    }
                    continue;
                }
                if (!seat.teamId || seat.memberIndex === undefined || seat.memberIndex === null) {
                    if (!errors.includes('Each ghost seat needs a teamId and a memberIndex.')) {
                        errors.push('Each ghost seat needs a teamId and a memberIndex.');
                    }
                    continue;
                }
                const key = logic.seatKey(seat.teamId, seat.memberIndex);
                if (seen.has(key)) {
                    if (!dupes.includes(key)) dupes.push(key);
                } else {
                    seen.add(key);
                }
            }
            if (dupes.length) {
                errors.push(`Duplicate ghost seat: ${dupes.join(', ')}.`);
            }

            return { ok: errors.length === 0, errors };
        },

        /**
         * Can `card` legally be played from this hand right now?
         *
         * True only when the card is still in the packet — `remainingHand` is
         * photo order minus played, so this rejects both a card already played
         * and a card the ghost never held (a mis-entry, or a spoofed write).
         *
         * @param {string} card Card code to play.
         * @param {string[]|null|undefined} cards The 13 codes in photo order.
         * @param {string[]|null|undefined} playedCards Codes already played.
         * @returns {boolean}
         */
        canPlay(card, cards, playedCards) {
            if (!Cards.isValidCode(card)) return false;
            return Cards.remainingHand(cards, playedCards).indexOf(card) !== -1;
        },

        /**
         * Split `items` into consecutive chunks of at most `size`.
         *
         * Exists because Firestore batches cap at 500 writes; a match with many
         * rounds can exceed that across two subcollections. Exact multiples do
         * NOT produce a trailing empty chunk.
         *
         * @param {*} items Array to split.
         * @param {number} [size=500] Maximum chunk length.
         * @returns {Array<Array<*>>} `[]` for empty/non-array input.
         */
        chunk(items, size = BATCH_LIMIT) {
            if (!Array.isArray(items) || items.length === 0) return [];
            const n = Math.max(1, Math.trunc(size) || BATCH_LIMIT);
            const out = [];
            for (let i = 0; i < items.length; i += n) {
                out.push(items.slice(i, i + n));
            }
            return out;
        },

        /**
         * Which matches the self-heal sweep should clean.
         *
         * Exactly those that are finished (`completed` or `cancelled`) AND
         * actually carry ghost data. A live match is never touched no matter
         * what it holds, and a finished match with no `ghostSeats` field is
         * skipped so the sweep costs nothing for the all-physical league.
         *
         * @param {*} allMatches Array of match documents (need `id`, `status`,
         *   and optionally `ghostSeats`).
         * @returns {Array<Object>} The subset needing `cleanupMatch`.
         */
        matchesNeedingSweep(allMatches) {
            if (!Array.isArray(allMatches)) return [];
            return allMatches.filter((m) => {
                if (!m || typeof m !== 'object') return false;
                if (m.status !== 'completed' && m.status !== 'cancelled') return false;
                const seats = m.ghostSeats;
                if (!seats || typeof seats !== 'object') return false;
                return Object.keys(seats).length > 0;
            });
        },

        /**
         * Coerce a caller-supplied `capturedRequest` into the number that goes
         * on the round doc.
         *
         * Defaults to 1 — the counter `requestCapture` creates a fresh round
         * doc with — so a caller that has not yet been updated still writes a
         * *comparable* number rather than `undefined`. That matters: a missing
         * `capturedRequest` is the only shape in which the station cannot see a
         * retake, so the field must never be absent on a write this service
         * performs.
         *
         * @param {*} value Caller-supplied request number.
         * @returns {number} A positive integer.
         */
        normaliseCapturedRequest(value) {
            const n = Math.trunc(Number(value));
            return Number.isFinite(n) && n >= 1 ? n : 1;
        },

        /**
         * Is a photo data URL small enough to store?
         * @param {*} dataUrl Candidate data URL string.
         * @returns {boolean}
         */
        isPhotoWithinLimit(dataUrl) {
            return typeof dataUrl === 'string'
                && dataUrl.length > 0
                && dataUrl.length <= MAX_PHOTO_CHARS;
        },

        // Constants re-exported so tests and callers share one source of truth.
        MAX_PHOTO_CHARS,
        BATCH_LIMIT,
        MAX_GHOST_SEATS,
        TABLE_SEATS,
    };

    // ─── Firestore service ─────────────────────────────────────────────────

    class GhostServiceClass {
        /**
         * @param {{db: Object}} firebaseService The app's FirebaseService.
         *   Only its `.db` (the raw `firebase.firestore()` handle) is used —
         *   subcollections, transactions and batches are not exposed by the
         *   wrapper's own methods, and the wrapper is deliberately not widened.
         */
        constructor(firebaseService) {
            if (!firebaseService || !firebaseService.db) {
                throw new Error('GhostService requires a firebaseService with a .db handle.');
            }
            this.db = firebaseService.db;
        }

        // ─── Key helpers (mirrors of `logic`, for call-site convenience) ───

        /** @see logic.seatKey */
        seatKey(teamId, memberIndex) {
            return logic.seatKey(teamId, memberIndex);
        }

        /** @see logic.roundDocId */
        roundDocId(roundIndex, seatKey) {
            return logic.roundDocId(roundIndex, seatKey);
        }

        // ─── Document references ───────────────────────────────────────────

        /** Reference to the match document that owns a set of ghost seats. */
        _matchRef(matchId) {
            return this.db.collection(MATCHES_COLLECTION).doc(String(matchId));
        }

        /** Reference to one seat's round doc for one round index. */
        _roundRef(matchId, roundIndex, seatKey) {
            return this._matchRef(matchId)
                .collection(ROUNDS_COLLECTION)
                .doc(logic.roundDocId(roundIndex, seatKey));
        }

        /**
         * Reference to one seat's photo doc — a *different document* from the
         * round doc with the same id, in a *different subcollection*. That
         * separation is the whole point: round docs are on a live listener and
         * change on every trick, so the ~200 KB photo must never ride along.
         */
        _photoRef(matchId, roundIndex, seatKey) {
            return this._matchRef(matchId)
                .collection(PHOTOS_COLLECTION)
                .doc(logic.roundDocId(roundIndex, seatKey));
        }

        /** `serverTimestamp()` sentinel, read lazily so importing needs no SDK. */
        _now() {
            return firebase.firestore.FieldValue.serverTimestamp();
        }

        // ─── Seats ─────────────────────────────────────────────────────────

        /**
         * Create the ghost seats for a match, generating one access code each.
         *
         * Codes come from `Cards.generateAccessCode` fed by
         * `crypto.getRandomValues` — never `Math.random`. The whole `ghostSeats`
         * map is written in one `update`, so a partial seat set can never exist.
         *
         * @param {string} matchId Match document id.
         * @param {Array<{teamId: string, memberIndex: number, memberName: string}>} seats
         *   1–3 seats to make remote.
         * @returns {Promise<Object>} The written `ghostSeats` map, keyed by seat
         *   key — the caller shows each code to the admin to DM out.
         * @throws {Error} If the selection is invalid or the write fails.
         */
        async createGhostSeats(matchId, seats) {
            const check = logic.validateSeatSelection(seats);
            if (!check.ok) {
                throw new Error(`Cannot create ghost seats: ${check.errors.join(' ')}`);
            }

            const ghostSeats = {};
            for (const seat of seats) {
                const key = logic.seatKey(seat.teamId, seat.memberIndex);
                ghostSeats[key] = {
                    teamId: seat.teamId,
                    memberIndex: seat.memberIndex,
                    memberName: seat.memberName === undefined || seat.memberName === null
                        ? ''
                        : String(seat.memberName),
                    accessCode: this._generateCode(),
                    active: true,
                };
            }

            try {
                await this._matchRef(matchId).update({ ghostSeats });
            } catch (error) {
                throw new Error(`Failed to create ghost seats: ${error.message || error}`);
            }
            return ghostSeats;
        }

        /**
         * One access code's worth of randomness → a 6-character code.
         * Split out so tests can stub it without stubbing global `crypto`.
         * @returns {string}
         */
        _generateCode() {
            const bytes = new Uint8Array(Cards.CODE_LENGTH);
            const source = typeof crypto !== 'undefined' ? crypto
                : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
            if (!source || typeof source.getRandomValues !== 'function') {
                throw new Error('Secure randomness (crypto.getRandomValues) is unavailable.');
            }
            source.getRandomValues(bytes);
            return Cards.generateAccessCode(bytes);
        }

        /**
         * Fetch one seat's definition (for the code gate).
         *
         * @param {string} matchId Match document id.
         * @param {string} seatKey From `seatKey()`.
         * @returns {Promise<Object|null>} The seat entry, or null when the match
         *   or the seat does not exist — the gate falls through silently on null.
         * @throws {Error} On a read failure (distinct from "not found").
         */
        async getGhostSeat(matchId, seatKey) {
            let doc;
            try {
                doc = await this._matchRef(matchId).get();
            } catch (error) {
                throw new Error(`Failed to read ghost seat: ${error.message || error}`);
            }
            if (!doc || !doc.exists) return null;
            const data = doc.data() || {};
            const seats = data.ghostSeats || {};
            return seats[seatKey] || null;
        }

        /**
         * Flip every seat on a match to `active: false` — the match is over, so
         * existing links stop resolving. The seat entries themselves survive so
         * a stale link falls through rather than erroring.
         *
         * No-op (not an error) when the match has no ghost seats at all.
         *
         * @param {string} matchId Match document id.
         * @returns {Promise<number>} How many seats were deactivated.
         * @throws {Error} On a read or write failure.
         */
        async deactivateSeats(matchId) {
            let doc;
            try {
                doc = await this._matchRef(matchId).get();
            } catch (error) {
                throw new Error(`Failed to deactivate ghost seats: ${error.message || error}`);
            }
            if (!doc || !doc.exists) return 0;

            const seats = (doc.data() || {}).ghostSeats;
            if (!seats || typeof seats !== 'object') return 0;

            const keys = Object.keys(seats);
            if (keys.length === 0) return 0;

            const next = {};
            for (const key of keys) {
                next[key] = { ...seats[key], active: false };
            }

            try {
                await this._matchRef(matchId).update({ ghostSeats: next });
            } catch (error) {
                throw new Error(`Failed to deactivate ghost seats: ${error.message || error}`);
            }
            return keys.length;
        }

        // ─── Capture ───────────────────────────────────────────────────────

        /**
         * Ask the station to fire the shutter for this seat.
         *
         * `captureRequest` is a monotonic counter, not a boolean: incrementing
         * it again is exactly a "retake", and the station reacts to the *change*
         * rather than to a flag it would then have to clear. Transactional so
         * two taps in flight cannot collapse into one capture.
         *
         * Creates the round doc if it does not exist yet — this is normally the
         * first write of a round.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @returns {Promise<number>} The new `captureRequest` value.
         * @throws {Error} On a transaction failure.
         */
        async requestCapture(matchId, roundIndex, seatKey) {
            const ref = this._roundRef(matchId, roundIndex, seatKey);
            try {
                return await this.db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap || !snap.exists) {
                        tx.set(ref, {
                            captureRequest: 1,
                            capturedAt: null,
                            capturedBy: '',
                            cards: null,
                            confirmedAt: null,
                            playedCards: [],
                            roundIndex: roundIndex,
                            seatKey: seatKey,
                        });
                        return 1;
                    }
                    const data = snap.data() || {};
                    const next = (Number(data.captureRequest) || 0) + 1;
                    tx.update(ref, { captureRequest: next });
                    return next;
                });
            } catch (error) {
                throw new Error(`Failed to request capture: ${error.message || error}`);
            }
        }

        /**
         * Store a captured hand photo and mark the round doc as captured.
         *
         * **Two documents, deliberately.** `photoData` goes to `ghostPhotos`;
         * only the lightweight markers go to the round doc that every open
         * listener is watching. Nothing here ever writes `photoData` onto a
         * round doc.
         *
         * ### `capturedRequest` — the retake contract
         *
         * `captureRequest` (on the round doc, written by `requestCapture`) is a
         * monotonic counter the ghost increments; **each increment past the
         * first is a retake**. `capturedRequest` is the counter value *this
         * photo answers*. The pair is what makes a retake observable to the
         * station at all:
         *
         *     capturedRequest === captureRequest  → this photo is current
         *     capturedRequest <  captureRequest   → the ghost asked again;
         *                                           the station owes a frame
         *
         * Without it the station cannot distinguish "photo delivered" from
         * "photo delivered, then the ghost hit Retake", so it would drop the
         * seat from its capture queue and the ghost would wait forever. The
         * caller therefore **must** pass the `captureRequest` value it actually
         * grabbed the frame for — not a re-read of the doc, which may have been
         * incremented again in the meantime.
         *
         * ### Partial-write contract (for the P2 station wiring)
         *
         * This is **two sequential writes and cannot be a transaction** — the
         * whole point of the two-doc design is that the ~200 KB photo never
         * shares a document (or a listener payload) with the round state, and
         * Firestore transactions would couple them again on every read.
         *
         * Therefore, on rejection the caller must assume **one of two states**:
         *
         * 1. *Nothing written* — the photo `set` failed. Retrying is clean.
         * 2. *Photo written, marker missing* — the photo doc exists but the
         *    round doc has no `capturedAt`/`capturedRequest`, so the ghost stays
         *    on WAITING_CAPTURE and every station still queues the seat.
         *
         * Both are repaired by **calling `writePhoto` again with the same
         * arguments** — the photo `set` is idempotent (full overwrite of one
         * doc id) and the marker write is a merge. The marker write is retried
         * once internally before the error surfaces, so a transient blip does
         * not reach the UI at all; a rejection means both attempts failed.
         *
         * **P2 must therefore implement a real retry / visible error on a
         * `writePhoto` rejection — never a silent `catch`** (implementation plan
         * §8: "no silent drops"). Surfacing it is what keeps the failure
         * recoverable: the table sees the seat still queued and re-shows the
         * hand, rather than the ghost staring at a screen that will never
         * update.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @param {string} dataUrl `'data:image/jpeg;base64,…'`, ≤700k chars.
         * @param {string} [capturedBy] Self-reported handler name. Display only
         *   — **escape it on render**.
         * @param {number} [capturedRequest] The `captureRequest` value this
         *   frame was grabbed for. Defaults to 1 (the first request of a round)
         *   when omitted; omitting it on a retake is a bug that leaves the
         *   ghost stuck, so pass it.
         * @returns {Promise<void>}
         * @throws {Error} If the photo is missing/oversized, or a write fails.
         *   See the partial-write contract above before writing a `catch`.
         */
        async writePhoto(matchId, roundIndex, seatKey, dataUrl, capturedBy, capturedRequest) {
            if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
                throw new Error('Cannot write photo: no image data was supplied.');
            }
            if (dataUrl.length > MAX_PHOTO_CHARS) {
                throw new Error(
                    `Photo is too large to store (${dataUrl.length} characters, limit `
                    + `${MAX_PHOTO_CHARS}). Retake it with more light.`
                );
            }

            const photoRef = this._photoRef(matchId, roundIndex, seatKey);
            const roundRef = this._roundRef(matchId, roundIndex, seatKey);
            const handler = capturedBy === undefined || capturedBy === null
                ? ''
                : String(capturedBy);
            const answered = logic.normaliseCapturedRequest(capturedRequest);

            const marker = {
                capturedAt: this._now(),
                capturedBy: handler,
                capturedRequest: answered,
                roundIndex: roundIndex,
                seatKey: seatKey,
            };

            try {
                // Photo first: an orphan photo doc is invisible and is
                // overwritten by the next attempt, whereas an orphan marker
                // would advertise a photo that does not exist and strand the
                // ghost on a blank review screen.
                await photoRef.set({
                    photoData: dataUrl,
                    roundIndex: roundIndex,
                    seatKey: seatKey,
                });
            } catch (error) {
                throw new Error(`Failed to save the captured hand: ${error.message || error}`);
            }

            // The marker is the write that makes the photo *visible*. It is the
            // small one and the one whose loss is worst (photo stored, nobody
            // told), so it gets one retry before the failure reaches the UI.
            try {
                await roundRef.set(marker, { merge: true });
            } catch (_firstAttemptFailed) {
                try {
                    await roundRef.set(marker, { merge: true });
                } catch (error) {
                    throw new Error(
                        'Failed to save the captured hand: the photo was stored but the '
                        + `round could not be marked as captured (${error.message || error}). `
                        + 'Capture again for this seat — retrying is safe.'
                    );
                }
            }
        }

        /**
         * One-shot read of a seat's photo. **Never a listener** — the photo is
         * fetched once, by one person, on demand. Subscribing to it would put
         * ~200 KB on the wire for every subsequent change.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @returns {Promise<string|null>} The data URL, or null if not captured.
         * @throws {Error} On a read failure.
         */
        async getPhoto(matchId, roundIndex, seatKey) {
            let doc;
            try {
                doc = await this._photoRef(matchId, roundIndex, seatKey).get();
            } catch (error) {
                throw new Error(`Failed to load the hand photo: ${error.message || error}`);
            }
            if (!doc || !doc.exists) return null;
            return (doc.data() || {}).photoData || null;
        }

        // ─── Hand + play ───────────────────────────────────────────────────

        /**
         * Record the ghost's digitised hand, in photo order.
         *
         * Photo order *is* physical order — every position announcement the
         * station makes derives from this array, so an invalid hand must never
         * reach Firestore. Validation is `Cards.validateHand`: exactly 13 valid,
         * distinct codes.
         *
         * Writes only `cards` and `confirmedAt` — no score-bearing decision of
         * any kind, per the card-delivery-only scope.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @param {string[]} cards 13 card codes in photo order (left → right).
         * @returns {Promise<void>}
         * @throws {Error} If the hand is invalid or the write fails.
         */
        async confirmHand(matchId, roundIndex, seatKey, cards) {
            const check = Cards.validateHand(cards);
            if (!check.ok) {
                throw new Error(`Cannot confirm hand: ${check.errors.join(' ')}`);
            }

            try {
                await this._roundRef(matchId, roundIndex, seatKey).set({
                    cards: cards.slice(),
                    confirmedAt: this._now(),
                    roundIndex: roundIndex,
                    seatKey: seatKey,
                }, { merge: true });
            } catch (error) {
                throw new Error(`Failed to confirm hand: ${error.message || error}`);
            }
        }

        /**
         * Invalidate a confirmed hand: clear `cards` and `confirmedAt`.
         *
         * The retake-after-confirm path. Once the ghost re-fires the shutter,
         * the confirmed hand describes a fan that no longer exists — and the
         * station computes every "5th from the left" against exactly that
         * array. Leaving it in place means the handler counts positions in a
         * packet the photo no longer matches and pulls the **wrong card,
         * face-down, into a live trick**, silently. So the stale hand must go.
         *
         * `confirmHand` cannot do this job: it hard-rejects anything that is
         * not exactly 13 valid distinct codes, by design, so it can never write
         * `cards: null`. This is the only method that clears a hand.
         *
         * ### `playedCards`: refuse rather than zero (decision)
         *
         * If the ghost has already played cards this round and then retakes,
         * the physical state is genuinely ambiguous — the packet on the table
         * has already lost cards to tricks, and those tricks happened. Two
         * options:
         *
         * - *Reset `playedCards` to `[]`* — silently erases real play history.
         *   The station would then announce positions counted against a
         *   13-card packet that physically holds fewer, mis-addressing every
         *   remaining card, and the trick record the table saw would disagree
         *   with the app with nobody told.
         * - *Refuse, and surface a message* — chosen. A hand with plays behind
         *   it can only be repaired by undoing those plays first (`undoLastCard`
         *   exists precisely for this, and the table etiquette for a take-back
         *   after the card hit the trick is already documented on the station).
         *   Refusing keeps `cards` and `playedCards` consistent with each other
         *   at every instant, and puts the ambiguity in front of the humans who
         *   can actually resolve it, which is this feature's whole repair
         *   model.
         *
         * A retake mid-play is rare and never silent either way; only one of
         * the two options can corrupt `remainingHand`.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @returns {Promise<boolean>} True when a hand was cleared; false when
         *   there was nothing to clear (no doc, or `cards` already empty) —
         *   idempotent, so a duplicate retake is not an error.
         * @throws {Error} If any card has already been played this round, or on
         *   a write failure.
         */
        async clearHand(matchId, roundIndex, seatKey) {
            const ref = this._roundRef(matchId, roundIndex, seatKey);

            let result;
            try {
                result = await this.db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap || !snap.exists) return { cleared: false };

                    const data = snap.data() || {};
                    const played = Array.isArray(data.playedCards) ? data.playedCards : [];
                    if (played.length > 0) {
                        return {
                            error: 'Cannot re-take this hand: '
                                + `${played.length} card${played.length === 1 ? ' has' : 's have'} `
                                + 'already been played this round. Take those back first '
                                + '(↩ Undo last card), then re-take the photo.',
                        };
                    }

                    const cards = Array.isArray(data.cards) ? data.cards : null;
                    if (!cards || cards.length === 0) return { cleared: false };

                    tx.set(ref, { cards: null, confirmedAt: null }, { merge: true });
                    return { cleared: true };
                });
            } catch (error) {
                throw new Error(`Failed to clear the hand: ${error.message || error}`);
            }

            if (result && result.error) throw new Error(result.error);
            return !!(result && result.cleared);
        }

        /**
         * Append a played card to `playedCards`.
         *
         * A transaction rather than `arrayUnion` for two reasons: the compat SDK
         * has no matching pop for undo (§10), and `arrayUnion` is set-semantics
         * — it would silently swallow the ordering this feature depends on.
         *
         * Rejects any card not currently in the packet, which covers both
         * "already played" and "never held".
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @param {string} card Card code to play.
         * @returns {Promise<string[]>} The new `playedCards` array.
         * @throws {Error} If the card cannot be played, or the write fails.
         */
        async playCard(matchId, roundIndex, seatKey, card) {
            if (!Cards.isValidCode(card)) {
                throw new Error(`Cannot play "${card}": not a valid card code.`);
            }
            const ref = this._roundRef(matchId, roundIndex, seatKey);

            let result;
            try {
                result = await this.db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap || !snap.exists) {
                        return { error: 'This round has not started yet.' };
                    }
                    const data = snap.data() || {};
                    const played = Array.isArray(data.playedCards) ? data.playedCards.slice() : [];

                    if (!logic.canPlay(card, data.cards, played)) {
                        const alreadyPlayed = played.indexOf(card) !== -1;
                        return {
                            error: alreadyPlayed
                                ? `${Cards.display(card).rank}${Cards.display(card).suit} has already been played.`
                                : `${Cards.display(card).rank}${Cards.display(card).suit} is not in your hand.`,
                        };
                    }

                    played.push(card);
                    tx.update(ref, { playedCards: played });
                    return { playedCards: played };
                });
            } catch (error) {
                throw new Error(`Failed to play card: ${error.message || error}`);
            }

            if (result && result.error) throw new Error(result.error);
            return result.playedCards;
        }

        /**
         * Pop the last entry off `playedCards` and return it.
         *
         * The card comes back so the caller can announce the take-back ("↩ Q♠
         * — slide it back 3rd from the left"); the position itself is
         * `Cards.reinsertPosition`, computed by the station.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @returns {Promise<string>} The card that was taken back.
         * @throws {Error} If nothing has been played, or the write fails.
         */
        async undoLastCard(matchId, roundIndex, seatKey) {
            const ref = this._roundRef(matchId, roundIndex, seatKey);

            let result;
            try {
                result = await this.db.runTransaction(async (tx) => {
                    const snap = await tx.get(ref);
                    if (!snap || !snap.exists) {
                        return { error: 'This round has not started yet.' };
                    }
                    const data = snap.data() || {};
                    const played = Array.isArray(data.playedCards) ? data.playedCards.slice() : [];
                    if (played.length === 0) {
                        return { error: 'There is no played card to take back.' };
                    }
                    const card = played.pop();
                    tx.update(ref, { playedCards: played });
                    return { card, playedCards: played };
                });
            } catch (error) {
                throw new Error(`Failed to take back the last card: ${error.message || error}`);
            }

            if (result && result.error) throw new Error(result.error);
            return result.card;
        }

        // ─── Listeners ─────────────────────────────────────────────────────

        /**
         * Live-watch one seat's round doc — the ghost's own view, and the
         * station's per-seat status. Photo data is *not* in this document, so
         * every trick update is a few bytes.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex Zero-based round index.
         * @param {string} seatKey From `seatKey()`.
         * @param {function(Object|null): void} callback Receives the doc data
         *   (with `id`), or null while the doc does not exist.
         * @returns {function(): void} Unsubscribe.
         */
        subscribeToGhostRound(matchId, roundIndex, seatKey, callback) {
            return this._roundRef(matchId, roundIndex, seatKey).onSnapshot((doc) => {
                if (!doc || !doc.exists) {
                    callback(null);
                    return;
                }
                callback({ id: doc.id, ...doc.data() });
            }, (error) => {
                console.error('Error in ghost round subscription:', error);
            });
        }

        /**
         * Live-watch every round doc belonging to one seat.
         *
         * Queried on the `seatKey` *field* — Firestore cannot filter by document
         * id prefix (§10), which is exactly why the round doc carries `seatKey`
         * and `roundIndex` as fields as well as in its id.
         *
         * @param {string} matchId Match document id.
         * @param {string} seatKey From `seatKey()`.
         * @param {function(Object[]): void} callback Receives the seat's round
         *   docs (each with `id`).
         * @returns {function(): void} Unsubscribe.
         */
        subscribeToSeatRounds(matchId, seatKey, callback) {
            return this._matchRef(matchId)
                .collection(ROUNDS_COLLECTION)
                .where('seatKey', '==', seatKey)
                .onSnapshot((snapshot) => {
                    const docs = (snapshot && snapshot.docs ? snapshot.docs : [])
                        .map((doc) => ({ id: doc.id, ...doc.data() }));
                    callback(docs);
                }, (error) => {
                    console.error('Error in ghost seat rounds subscription:', error);
                });
        }

        // ─── Cleanup ───────────────────────────────────────────────────────

        /**
         * Delete every seat's round + photo doc for one round index.
         *
         * Called after the table submits that round at the Game Board. Deletes
         * by explicit index, so a hand already dealt for round N+1 is untouched.
         *
         * **Addressing: `doc.ref` and `doc.id`, never a data field.** The round
         * doc is deleted through the reference the query already handed us, and
         * the photo doc is derived from `doc.id`, which is
         * `{roundIndex}_{seatKey}` **by construction** (`logic.roundDocId`).
         * Rebuilding both paths from the mutable `seatKey` *field* would, on a
         * doc missing that field, produce `"{roundIndex}_undefined"` — deletes
         * that hit nothing while reporting success, silently leaking a ~200 KB
         * hand photo past the end of the match. Cleanup is the only thing that
         * removes photos at all (there is no bucket and no scheduled job), so
         * it must not depend on a field being present.
         *
         * @param {string} matchId Match document id.
         * @param {number} roundIndex The index just submitted.
         * @returns {Promise<number>} How many documents were deleted.
         * @throws {Error} On a read or delete failure.
         */
        async cleanupRound(matchId, roundIndex) {
            let refs;
            try {
                const snapshot = await this._matchRef(matchId)
                    .collection(ROUNDS_COLLECTION)
                    .where('roundIndex', '==', roundIndex)
                    .get();
                const docs = (snapshot && snapshot.docs) ? snapshot.docs : [];
                refs = [];
                const photos = this._matchRef(matchId).collection(PHOTOS_COLLECTION);
                for (const doc of docs) {
                    // The round doc: the reference we already hold.
                    refs.push(doc.ref);
                    // The photo doc: same id, sibling subcollection. Structural,
                    // not field-derived.
                    refs.push(photos.doc(doc.id));
                }
            } catch (error) {
                throw new Error(`Failed to clean up round ${roundIndex}: ${error.message || error}`);
            }

            await this._deleteRefs(refs, `round ${roundIndex}`);
            return refs.length;
        }

        /**
         * End-of-match teardown: deactivate the seats, then delete both
         * subcollections in full. The photo docs die with them — no bucket, no
         * scheduled job, nothing left to leak.
         *
         * @param {string} matchId Match document id.
         * @returns {Promise<number>} How many documents were deleted.
         * @throws {Error} On any step failing.
         */
        async cleanupMatch(matchId) {
            await this.deactivateSeats(matchId);

            let refs = [];
            try {
                for (const name of [ROUNDS_COLLECTION, PHOTOS_COLLECTION]) {
                    const snapshot = await this._matchRef(matchId).collection(name).get();
                    const docs = (snapshot && snapshot.docs) ? snapshot.docs : [];
                    for (const doc of docs) refs.push(doc.ref);
                }
            } catch (error) {
                throw new Error(`Failed to clean up match ${matchId}: ${error.message || error}`);
            }

            await this._deleteRefs(refs, `match ${matchId}`);
            return refs.length;
        }

        /**
         * Delete a list of document references, batched at Firestore's 500-write
         * ceiling. Batches commit sequentially so a partial failure leaves a
         * prefix deleted rather than an unpredictable interleaving.
         *
         * @param {Array<Object>} refs Document references.
         * @param {string} what Label for the error message.
         * @returns {Promise<void>}
         * @throws {Error} On any batch failing to commit.
         */
        async _deleteRefs(refs, what) {
            const batches = logic.chunk(refs, BATCH_LIMIT);
            try {
                for (const group of batches) {
                    const batch = this.db.batch();
                    for (const ref of group) batch.delete(ref);
                    await batch.commit();
                }
            } catch (error) {
                throw new Error(`Failed to delete ghost data for ${what}: ${error.message || error}`);
            }
        }

        /**
         * Self-heal sweep, run once on app load: clean up any match that has
         * already finished but still carries ghost data — the tab that died
         * before its own cleanup write, typically.
         *
         * Touches nothing else. Live matches are never swept, and a finished
         * match with no `ghostSeats` field costs zero reads and zero writes.
         *
         * Per-match failures are logged and skipped rather than thrown: a sweep
         * is best-effort housekeeping on app boot and must never block startup.
         *
         * @param {Array<Object>} allMatches Every match doc the app has loaded.
         * @returns {Promise<{swept: string[], failed: string[]}>} Match ids by outcome.
         */
        async sweepOrphans(allMatches) {
            const targets = logic.matchesNeedingSweep(allMatches);
            const swept = [];
            const failed = [];
            for (const match of targets) {
                try {
                    await this.cleanupMatch(match.id);
                    swept.push(match.id);
                } catch (error) {
                    console.error(`Ghost sweep failed for match ${match.id}:`, error);
                    failed.push(match.id);
                }
            }
            return { swept, failed };
        }
    }

    // Pure logic hangs off the constructor so tests reach it without a Firestore.
    GhostServiceClass.logic = logic;
    GhostServiceClass.prototype.logic = logic;

    return GhostServiceClass;
})();

// Singleton, mirroring matchService.js — initialised from app.js.
let ghostService = null;

/**
 * Build (and memoise) the app-wide GhostService.
 * @param {{db: Object}} firebaseService The app's FirebaseService instance.
 * @returns {GhostService}
 */
function initializeGhostService(firebaseService) {
    ghostService = new GhostService(firebaseService);
    return ghostService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GhostService;
}
