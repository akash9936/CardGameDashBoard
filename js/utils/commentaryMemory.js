/**
 * Commentary Memory — anti-repetition state, per match.
 *
 * Spec: claude/commentary-style.md §8. This is NOT conversational memory and
 * NOT game memory: it remembers only *how things were said*, never what
 * happened. Game facts stay in factsEngine, computed from match.rounds.
 *
 * Why it exists: the model is stateless per call and gets no previous lines,
 * so it cannot avoid repeating itself. Something outside the model has to
 * remember. A match is ~8 rounds (max 14 in the season), so a small ledger
 * covers a whole match comfortably.
 *
 * What it tracks per match:
 *   phraseIds — every comedy-library phrase already spoken
 *   forms     — recent sentence shapes (deadpan, question, …)
 *   intents   — recent narrative situations
 *   openings  — first two words of recent lines, so every line does not start
 *               "Arre bhai" (the single most noticeable tic out loud)
 *
 * Pure and injectable-free: plain in-memory maps, cleared per session. Nothing
 * here is persisted — a new session starting fresh is correct, since nobody
 * remembers last week's jokes either.
 */
const CommentaryMemory = (() => {

    // How much history each ring buffer keeps. Forms and intents are short:
    // avoiding the last 3 is enough to stop back-to-back sameness without
    // starving the selection. Phrase ids are unbounded within a match —
    // "never repeat a phrase in one match" is the actual goal.
    // Forms must outlast the form list itself. With 5 shapes and a 3-deep
    // buffer, every unused form ties as "oldest" and the tie always resolves to
    // the earliest in the list — so the tail shape is never spoken. Keeping a
    // full cycle of history makes the rotation actually round-robin.
    const RECENT_FORMS = 8;
    const RECENT_INTENTS = 3;
    const RECENT_OPENINGS = 4;

    // matchId → ledger
    const ledgers = new Map();

    function _blank() {
        return { phraseIds: [], forms: [], intents: [], openings: [] };
    }

    function ledgerFor(matchId) {
        const key = String(matchId);
        if (!ledgers.has(key)) ledgers.set(key, _blank());
        return ledgers.get(key);
    }

    function _pushCapped(arr, value, cap) {
        if (value === undefined || value === null || value === '') return;
        arr.push(value);
        while (arr.length > cap) arr.shift();
    }

    // First two words, lowercased and stripped of punctuation — enough to
    // catch "Arre bhai!" / "arre bhai," as the same opening.
    function openingOf(line) {
        return String(line || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .join(' ');
    }

    // What the packet should carry so the prompt can steer away from repeats.
    function state(matchId) {
        const l = ledgerFor(matchId);
        return {
            usedPhraseIds: l.phraseIds.slice(),
            recentForms: l.forms.slice(),
            recentIntents: l.intents.slice(),
            recentOpenings: l.openings.slice(),
        };
    }

    // Pick the sentence shape for this line: genuinely least-recently-used, so
    // rotation is enforced in code rather than requested in a prompt.
    //
    // Ordering by recency matters. Taking the first *unused* form instead
    // starves the tail of the list: with a 3-deep buffer over 5 forms it cycles
    // a 4-form subset forever and the 5th shape is never spoken.
    // `forms` is ComedyLibrary.forms().
    function nextForm(matchId, forms) {
        const list = Array.isArray(forms) ? forms : [];
        if (!list.length) return null;
        const recent = ledgerFor(matchId).forms;
        // Position in `recent` = how recently used; -1 (absent) is oldest.
        const staleness = f => {
            const i = recent.lastIndexOf(f.id);
            return i === -1 ? -1 : i;
        };
        return list.slice().sort((a, b) => staleness(a) - staleness(b))[0];
    }

    // Record what was actually spoken. Call this ONLY after the line really
    // reached the speaker — a moment that was skipped (no key, wrong language,
    // speech unavailable) must not burn a phrase or a form.
    function record(matchId, { phraseId, form, intent, line } = {}) {
        const l = ledgerFor(matchId);
        if (phraseId && !l.phraseIds.includes(phraseId)) l.phraseIds.push(phraseId);
        _pushCapped(l.forms, form, RECENT_FORMS);
        _pushCapped(l.intents, intent, RECENT_INTENTS);
        _pushCapped(l.openings, openingOf(line), RECENT_OPENINGS);
    }

    // Did this match already use this phrase?
    function hasUsed(matchId, phraseId) {
        return ledgerFor(matchId).phraseIds.includes(phraseId);
    }

    function forget(matchId) { ledgers.delete(String(matchId)); }
    function _reset() { ledgers.clear(); }

    return {
        state, nextForm, record, hasUsed, openingOf, forget, ledgerFor,
        RECENT_FORMS, RECENT_INTENTS, RECENT_OPENINGS,
        _reset,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CommentaryMemory;
}
