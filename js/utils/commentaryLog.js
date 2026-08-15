/**
 * Commentary Log — the scrollback for everything the broadcast has said.
 *
 * Why it exists: the broadcast strip is a *now* surface. It shows the latest
 * WHAT/WHY/NEXT and nothing else, and every re-render of the matches list wipes
 * it. Spoken lines were even more ephemeral — generated, said out loud, gone.
 * If you looked away during round 4 there was no way to get that line back.
 *
 * This module is the memory of *what was said*, so the strip can stay a now
 * surface and history lives one click below it.
 *
 * Not to be confused with its two neighbours:
 *   - factsEngine     — what HAPPENED (computed from match.rounds, never stored)
 *   - commentaryMemory — HOW things were phrased, per session, to avoid repeats
 *   - commentaryLog   — WHAT WAS SAID, persisted, so a human can scroll it
 *
 * Storage: localStorage, one key for the whole log. Per CLAUDE.md §0 the data
 * volume is tiny (~10 teams, tens of matches, ~8-14 rounds each), so a single
 * JSON blob read/written whole is the right call — no index, no per-match keys.
 * Capped at MAX_PER_MATCH newest entries per match and MAX_MATCHES matches, so
 * an abandoned browser cannot grow the key without bound.
 *
 * Everything degrades to a no-op when storage is unavailable (private mode,
 * quota, blocked): append() returns null, entries() returns []. The commentary
 * itself never depends on this module succeeding.
 */
const CommentaryLog = (() => {
    const STORAGE_KEY = 'aiCommentary.log';

    // A match is ~8 rounds, max 14 in the season, and each round can produce a
    // screen line plus a spoken line plus a pundit line. 60 covers the longest
    // possible match several times over while keeping the blob small.
    const MAX_PER_MATCH = 60;
    // Ten teams playing each other leaves far fewer than 40 matches worth
    // caring about; older matches drop out of the log, not out of the database.
    const MAX_MATCHES = 40;

    let _storage = (typeof localStorage !== 'undefined') ? localStorage : null;

    // { [matchId]: Entry[] } — entries oldest-first, which is the order they
    // are read in. Newest-first would mean reversing on every render.
    function _read() {
        try {
            if (!_storage) return {};
            const raw = _storage.getItem(STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
        } catch (e) {
            return {};   // corrupt or blocked — start clean rather than throw
        }
    }

    function _write(all) {
        try {
            if (!_storage) return false;
            _storage.setItem(STORAGE_KEY, JSON.stringify(all));
            return true;
        } catch (e) {
            // Quota exceeded is the realistic failure. Drop the oldest match
            // and try once — a full log must not break the round that is
            // being played right now.
            try {
                const keys = Object.keys(all);
                if (keys.length > 1) {
                    delete all[keys[0]];
                    _storage.setItem(STORAGE_KEY, JSON.stringify(all));
                    return true;
                }
            } catch (e2) { /* give up quietly */ }
            return false;
        }
    }

    // Identity of a line, so the same moment logged twice — a re-render, a
    // Firestore snapshot echo, a double submit — appends once. Kind matters:
    // the screen line and the spoken line for the same round are different
    // entries and both deserve a slot.
    function _dedupeKey(entry) {
        return `${entry.kind}:${entry.round}`;
    }

    /**
     * Append one line to a match's log.
     *
     * @param matchId
     * @param entry {
     *     kind:  'round' | 'spoken' | 'pundit' | 'start' | 'result'
     *     round: round number the line belongs to (0 for match start)
     *     text:  the line itself — what was actually said
     *     what/why/next: optional, the three-part screen narration
     *     actor: optional team name the moment is about
     *     source: 'ai' | 'template' — was this an LLM line or the built-in phrasing
     *     at:    epoch ms; caller supplies it so this module stays testable
     * }
     * @returns the stored entry, or null if it was a duplicate / storage is off.
     */
    function append(matchId, entry) {
        if (!matchId || !entry || !entry.text) return null;

        const id = String(matchId);
        const record = {
            kind: entry.kind || 'round',
            round: Number(entry.round) || 0,
            text: String(entry.text),
            at: Number(entry.at) || _now(),
        };
        if (entry.what) record.what = String(entry.what);
        if (entry.why) record.why = String(entry.why);
        if (entry.next) record.next = String(entry.next);
        if (entry.actor) record.actor = String(entry.actor);
        if (entry.source) record.source = String(entry.source);
        // Which callback this line made, by shape ("blind:3"). Read back by
        // Callbacks.alreadyMade so the same observation is never made twice in
        // a match — a repeated callback is a stutter, not a callback.
        if (entry.callback) record.callback = String(entry.callback);

        const all = _read();
        const list = Array.isArray(all[id]) ? all[id] : [];

        // Same moment already logged — keep the first, ignore the echo.
        const key = _dedupeKey(record);
        if (list.some(e => _dedupeKey(e) === key)) return null;

        list.push(record);
        // Trim from the front: the newest lines are the ones worth keeping.
        while (list.length > MAX_PER_MATCH) list.shift();
        all[id] = list;

        // Evict whole matches once there are too many. Object key order is
        // insertion order for string keys that aren't integer-like — match ids
        // here are Firestore-style strings — so the first key is the least
        // recently created entry in the log.
        const ids = Object.keys(all);
        if (ids.length > MAX_MATCHES) {
            for (const stale of ids.slice(0, ids.length - MAX_MATCHES)) {
                if (stale !== id) delete all[stale];
            }
        }

        return _write(all) ? record : null;
    }

    // Oldest-first, which is how a transcript reads.
    function entries(matchId) {
        if (!matchId) return [];
        const list = _read()[String(matchId)];
        return Array.isArray(list) ? list.slice() : [];
    }

    function count(matchId) {
        return entries(matchId).length;
    }

    function clear(matchId) {
        const all = _read();
        if (matchId === undefined || matchId === null) {
            _write({});
            return;
        }
        delete all[String(matchId)];
        _write(all);
    }

    function _now() {
        return Date.now();
    }

    // ─── Test hooks ──────────────────────────────────────────────────────────
    function _setStorage(s) { _storage = s; }

    return {
        append, entries, count, clear,
        MAX_PER_MATCH, MAX_MATCHES, STORAGE_KEY,
        _setStorage, _dedupeKey,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommentaryLog;
}
