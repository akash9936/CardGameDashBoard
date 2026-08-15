/**
 * Groq Service — the single path between the app and the Groq API.
 *
 * Spec: ai-commentary.md. Hard boundaries:
 *   - BYO key from localStorage; no key → every call resolves null, silently.
 *   - The LLM is a wordsmith: facts packet in, 1–2 sentences out. The output
 *     is displayed verbatim (escaped by the UI) and NEVER parsed as data.
 *   - Any failure (timeout, 401, 429, offline) resolves null — the UI simply
 *     doesn't show a pundit line. Nothing throws to callers.
 *
 * Caching (spec § Design decisions):
 *   - live lines:  in-memory, keyed matchId:roundCount — one call per round
 *   - recaps:      localStorage — finished matches never change
 *   - in-flight:   one request per match at a time
 *
 * fetch / storage are injectable for Node tests.
 */
const GroqService = (() => {
    const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
    const MODEL = 'llama-3.3-70b-versatile';
    const TIMEOUT_MS = 4000;
    // Spoken lines have a tighter deadline: the table is standing there
    // waiting for the laptop to say something (spec § Spoken commentary).
    const SPOKEN_TIMEOUT_MS = 2500;
    const MAX_LINE_CHARS = 220;

    const KEY_STORAGE = 'aiCommentary.groqKey';
    const RECAP_STORAGE = 'aiCommentary.recaps';
    const MAX_RECAPS = 50;

    // The whole rules context the model gets — enough to understand what a
    // blind or an over-extension *means*, never enough to "recompute" anything.
    const SYSTEM_PROMPT = [
        'You are a witty live commentator for an office card-game league.',
        'Game in one breath: each round both teams promise 4-13 hands (or call',
        'BLIND for a fixed 7). Missing the promise or taking double it scores',
        'minus promise x10; meeting it scores promise x10 plus 1 per extra hand;',
        'a blind is +140 if it lands, -70 if it fails. First team to 500 points',
        'wins the match.',
        'You will receive a JSON packet of pre-computed facts about one match.',
        'Write 1-2 short, punchy sentences of commentary. Use ONLY the numbers',
        'and facts provided. Never invent statistics, records, or events.',
        'No markdown, no quotes around your answer, no preamble — just the line.',
    ].join(' ');

    // Spoken mode (spec § Spoken commentary): comedy about real numbers, said
    // out loud. Distinct from the on-screen prompt — this one must be one
    // sentence, speakable, and land its joke on the risk that was taken.
    const SPOKEN_PROMPT = [
        'You are a funny live commentator for an office card-game league,',
        'speaking out loud over a table of friends.',
        'Game in one breath: each round both teams promise 4-13 hands (or call',
        'BLIND for a fixed 7). Missing the promise or taking double it scores',
        'minus promise x10; meeting it scores promise x10 plus 1 per extra hand;',
        'a blind is +140 if it lands, -70 if it fails. First team to 500 wins.',
        'You will receive a JSON packet describing one dramatic moment that just',
        'happened, with the exact numbers.',
        'Every round gets commentary, so vary your phrasing — never open two',
        'lines the same way, and do not say "oh my" every time.',
        'Match the packet\'s "moment" field:',
        '- match-start: TWO sentences. Name both teams and tee up the contest.',
        '- match-end: TWO sentences. First celebrate the winner BY NAME with',
        '  their winning score; then tease the losing team by name with light,',
        '  affectionate mockery — they are friends and colleagues, so never',
        '  cruel, never personal, always about the cards.',
        '- routine: ONE brisk, matter-of-fact sentence with a wry aside.',
        '- anything else: ONE sentence, play up the drama.',
        'Be genuinely funny: tease the risk, the greed, or the nerve.',
        'Use AT MOST two numbers from the packet, and copy them exactly.',
        'Never invent or derive statistics, swings, totals, records, or events —',
        'if a number is not in the packet, do not say it. Do not do arithmetic.',
        // Comedy steering. The engine picks the situation and the shape; the
        // model supplies the words. Phrases are offered as register, not as
        // lines to quote — a recited phrase sounds like a recited phrase.
        'The packet may carry a "comedy" block. When it does:',
        '- "formHint" is how to shape THIS line. Follow it.',
        '- "phrases" are example expressions in the right register. Use one only',
        '  if it fits naturally, and bend it to the sentence — never quote a',
        '  phrase verbatim as the whole line.',
        '- "avoidOpenings" lists how recent lines began. Do not start this line',
        '  with any of them.',
        'The packet may also carry "round" with both teams\' promise and actual.',
        'The two actuals always add up to 13, so one side\'s gain is the other',
        'side\'s loss — when it is interesting, say what the other team did.',
        'It will be read aloud by a speech synthesiser: no markdown, no emoji,',
        'no quotes, no preamble, no stage directions. Just the sentence.',
        // Length last: instruction-following is strongest at the end of the
        // prompt, and word-count limits are routinely ignored while an explicit
        // sentence count is not.
        'Reply with ONE sentence, unless the moment field says match-start or',
        'match-end, which take exactly TWO. Keep each sentence short.',
    ].join(' ');

    // ─── Injectable environment (browser defaults, overridable in tests) ─────
    let _fetch = (typeof fetch !== 'undefined') ? fetch.bind(globalThis) : null;
    let _storage = (typeof localStorage !== 'undefined') ? localStorage : null;

    // ─── Session state ───────────────────────────────────────────────────────
    const liveCache = new Map();   // "matchId:roundCount" → line
    const inflight = new Set();    // matchId currently awaiting a response
    let keyRejected = false;       // a 401 this session; surfaced in settings
    let modelBroken = false;       // 4xx model error → stop quietly for the session
    // A 429 means the key's quota is spent. Unlike a 401 this is temporary, so
    // it is a deadline rather than a flag: calls are skipped until it passes,
    // then the next one is allowed through to find out if quota came back.
    //
    // Without this every card decoration re-fired on every render, each one
    // burning more quota and pushing the reset further out — the app DDoSed
    // its own rate limit and stayed mute the whole time.
    let rateLimitedUntil = 0;      // epoch ms; 0 = not limited
    const DEFAULT_COOLDOWN_MS = 60_000;
    const MAX_COOLDOWN_MS = 60 * 60_000;   // an hour — daily caps report far longer
    let _now = () => Date.now();

    // ─── Key management ──────────────────────────────────────────────────────
    function getKey() {
        try { return _storage ? (_storage.getItem(KEY_STORAGE) || null) : null; }
        catch (e) { return null; }
    }
    function setKey(key) {
        keyRejected = false;
        modelBroken = false;
        rateLimitedUntil = 0;   // a new key gets a clean slate and its own quota
        try {
            if (!_storage) return;
            if (key) _storage.setItem(KEY_STORAGE, key.trim());
            else _storage.removeItem(KEY_STORAGE);
        } catch (e) { /* storage full/blocked — feature just stays off */ }
    }
    function hasKey() { return !!getKey(); }
    function wasKeyRejected() { return keyRejected; }

    // True while the key's quota is spent. The UI announces this instead of
    // failing mute — a silent commentator is indistinguishable from a broken
    // one, which is exactly how this went unnoticed.
    function isRateLimited() { return rateLimitedUntil > _now(); }

    // Whole minutes until the next attempt (0 when not limited), for the
    // message. Rounded up so "1 min" never means "already, actually".
    function rateLimitMinutesLeft() {
        if (!isRateLimited()) return 0;
        return Math.ceil((rateLimitedUntil - _now()) / 60_000);
    }

    // Groq sends `retry-after` in seconds; honour it when sane, since it knows
    // the real reset far better than a guess does.
    function _noteRateLimited(res) {
        let waitMs = DEFAULT_COOLDOWN_MS;
        try {
            const raw = res && res.headers && typeof res.headers.get === 'function'
                ? res.headers.get('retry-after')
                : null;
            const secs = raw != null ? Number(raw) : NaN;
            if (Number.isFinite(secs) && secs > 0) waitMs = secs * 1000;
        } catch (e) { /* header unreadable — fall back to the default */ }
        rateLimitedUntil = _now() + Math.min(waitMs, MAX_COOLDOWN_MS);
    }

    // ─── Recap cache (localStorage — finished matches never change) ──────────
    function _readRecaps() {
        try {
            const raw = _storage ? _storage.getItem(RECAP_STORAGE) : null;
            const parsed = raw ? JSON.parse(raw) : null;
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) { return {}; }
    }
    function _writeRecap(matchId, line) {
        try {
            if (!_storage) return;
            const recaps = _readRecaps();
            recaps[matchId] = line;
            // Prune to the most recent MAX_RECAPS entries (insertion order).
            const keys = Object.keys(recaps);
            if (keys.length > MAX_RECAPS) {
                for (const k of keys.slice(0, keys.length - MAX_RECAPS)) delete recaps[k];
            }
            _storage.setItem(RECAP_STORAGE, JSON.stringify(recaps));
        } catch (e) { /* non-fatal */ }
    }

    // Script guard. A speech synthesiser pronounces by script, so a Hindi
    // voice handed romanised Hindi ("blind call kiya") reads it with English
    // phonetics and sounds wrong. Some models ignore the "native script"
    // instruction for Indic languages no matter how it is phrased, so the
    // output is verified rather than trusted: wrong script → reject the line
    // and let the caller speak its own template instead.
    const SCRIPT_RANGES = {
        hi: /[ऀ-ॿ]/, bn: /[ঀ-৿]/, ta: /[஀-௿]/,
        te: /[ఀ-౿]/, kn: /[ಀ-೿]/, ru: /[Ѐ-ӿ]/,
        uk: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/, he: /[֐-׿]/,
        el: /[Ͱ-Ͽ]/, th: /[฀-๿]/, ja: /[぀-ヿ一-鿿]/,
        ko: /[가-힯]/, zh: /[一-鿿]/, yue: /[一-鿿]/,
    };

    // Hinglish cannot be verified by script — it is deliberately Latin, so
    // SCRIPT_RANGES has no entry for it and every reply would pass, including a
    // plain English one. The failure mode worth catching is the model quietly
    // answering in English, so this checks for *Hindi* instead: a handful of
    // function words that appear in almost any real Hinglish sentence.
    //
    // Content words are useless here (an English line may well contain "blind"
    // or a team name); these are grammatical glue that only appears when the
    // sentence is actually built in Hindi.
    // Words that are ALSO ordinary English are deliberately excluded, however
    // common they are in Hindi: "the" (Hindi: they were) matched every English
    // sentence, and "par", "ab", "se", "sab", "kar" all collide too. What is
    // left only appears when the sentence is genuinely built in Hindi.
    const HINGLISH_MARKERS = /\b(ne|ka|ki|ko|hai|hain|tha|thi|gaya|gayi|gaye|diya|liya|karke|mein|bhi|toh|phir|nahi|aur|kya|bhai|apna|apni|inka|unka|raha|rahi|kuch|itna|bahut)\b/i;

    function looksHinglish(line) {
        const s = String(line);
        // Devanagari is not the target register, but it is unmistakably Hindi
        // and a Hindi voice reads it correctly — so accept rather than reject.
        if (/[ऀ-ॿ]/.test(s)) return true;
        return HINGLISH_MARKERS.test(s);
    }

    function usesExpectedScript(line, langCode) {
        if (String(langCode || '').toLowerCase() === 'hinglish') return looksHinglish(line);
        const re = SCRIPT_RANGES[langCode];
        if (!re) return true;          // Latin-script languages need no check
        return re.test(String(line));
    }

    // ─── Language direction (data, not a template literal) ───────────────────
    // Most languages want the same thing: their own script, numbers as words.
    // Hinglish wants the opposite of both, so the instruction cannot be built
    // by interpolating a language name — `Write in Hinglish using the native
    // script of Hinglish (never romanised)` is incoherent, and it is exactly
    // what the old template produced.
    //
    // Anything not listed here falls back to DEFAULT_DIRECTION.
    const LANGUAGE_DIRECTION = {
        // The house register: Hindi grammar, Latin script, English kept for the
        // words the table actually says in English. Deliberately NOT a
        // SCRIPT_RANGES entry — see scriptCodeFor().
        hinglish: 'Write the line in Hinglish — Hindi and English mixed the way'
            + ' Indian friends actually talk at a card table, in Latin script'
            + ' (never Devanagari). Keep the card words in English: blind, bid,'
            + ' points, round, score, game, match. Keep team names exactly as'
            + ' given. Write numbers as digits. Do not translate into formal'
            + ' Hindi and do not write plain English —'
            + ' "Coke ne blind mara, 140 le gaye" is the target.',
    };

    function DEFAULT_DIRECTION(language) {
        // Native script matters: the synthesiser pronounces by script, so
        // romanised Hindi ("blind call kiya") is read with English phonetics by
        // a Hindi voice and sounds wrong.
        return `Write the line in ${language}, not English,`
            + ` using the native script of ${language}`
            + ' (never romanised or transliterated Latin letters).'
            + ' Keep team names exactly as given, in their original spelling.'
            + ' Write all numbers as words in that language.';
    }

    function languageDirection(langCode, language) {
        const byCode = LANGUAGE_DIRECTION[String(langCode || '').toLowerCase()];
        if (byCode) return byCode;
        if (!language || language === 'English') return null;
        return DEFAULT_DIRECTION(language);
    }

    // Spoken lines must end cleanly — a sentence cut mid-word is jarring read
    // aloud. Keep whole sentences only; if the model rambled without
    // punctuation, cut at the last whole word.
    //
    // Round calls get one sentence. The match-start and match-end moments get
    // two, because they carry a beat the single-sentence cap kept cutting off:
    // the opening matchup, and the winner-then-loser turn.
    const SPOKEN_MAX_CHARS = 190;
    const EVENT_MAX_CHARS = 320;
    const TWO_SENTENCE_MOMENTS = new Set(['match-start', 'match-end']);

    // Sentence terminators, split by whether a following space is required.
    //
    // Latin-style marks also end abbreviations and decimals ("Rs. 500", "3.5"),
    // so they only count as a sentence end when whitespace or end-of-string
    // follows. CJK and Indic terminators carry no such ambiguity and are
    // routinely written with no space after them, so requiring one would skip
    // them entirely — which is exactly the bug this replaces: the old
    // /[.!?](\s|$)/ never matched Devanagari danda, so for Hindi (a shipped,
    // key-gated language) the whole reply passed through untrimmed and the
    // one-sentence contract silently did not apply.
    //
    //   ।  U+0964 danda      — Hindi, Bengali, and other Indic scripts
    //   ॥  U+0965 double danda
    //   。 U+3002 ideographic full stop — Chinese, Japanese
    //   ！ U+FF01 / ？ U+FF1F fullwidth bang and question mark
    //   ؟  U+061F Arabic question mark
    //   ۔  U+06D4 Arabic full stop (Urdu)
    //
    // Deliberately NOT included: the Greek question mark U+037E, which is
    // canonically equivalent to an ASCII ";" and cannot be distinguished from
    // one here. Including it would cut every English line at its first
    // semicolon. Greek falls back to the "." branch, which is correct for it.
    const SENTENCE_END_SPACED = /[.!?](\s|$)/;          // needs a space after
    const SENTENCE_END_BARE = /[।॥。！？؟۔]/;

    // Which full stop to append when a line is cut at the character cap.
    // Hinglish is deliberately mixed-script and reads as Latin prose, so it
    // takes "." — only a wholly Indic/CJK line gets its own mark.
    const INDIC_DANDA = /[ऀ-ॿঀ-৿]/;   // Devanagari, Bengali
    const CJK_STOP = /[぀-ヿ一-鿿가-힯]/;
    const ARABIC_STOP = /[؀-ۿ]/;

    function terminatorFor(text) {
        const latin = (String(text).match(/[A-Za-z]/g) || []).length;
        const indic = (String(text).match(/[ऀ-৿]/g) || []).length;
        if (CJK_STOP.test(text)) return '。';
        // A line with more Latin letters than Indic ones is Hinglish, not Hindi.
        if (INDIC_DANDA.test(text) && indic >= latin) return '।';
        if (ARABIC_STOP.test(text) && !latin) return '۔';
        return '.';
    }

    function trimToFirstSentence(text, maxSentences = 1, maxChars = SPOKEN_MAX_CHARS) {
        // Collapse newlines — the model sometimes puts each sentence on its
        // own line, which is invisible on screen but reads as a stumble aloud.
        let s = String(text).replace(/\s+/g, ' ').trim();

        // Keep up to maxSentences complete sentences. Each step takes whichever
        // terminator comes first, so mixed-script replies (a Hinglish line with
        // both "." and "।") cut at the right place.
        let cut = 0, taken = 0;
        while (taken < maxSentences) {
            const rest = s.slice(cut);
            const spaced = rest.search(SENTENCE_END_SPACED);
            const bare = rest.search(SENTENCE_END_BARE);
            let idx;
            if (spaced === -1) idx = bare;
            else if (bare === -1) idx = spaced;
            else idx = Math.min(spaced, bare);
            if (idx === -1) break;
            cut += idx + 1;
            taken++;
        }
        if (cut > 0) s = s.slice(0, cut);

        if (s.length > maxChars) {
            s = s.slice(0, maxChars);
            // Back off to a word boundary. CJK is written without inter-word
            // spaces, so there may be none to find — cutting at the character
            // is correct there and does not strand a half-word.
            const lastSpace = s.lastIndexOf(' ');
            if (lastSpace > 40) s = s.slice(0, lastSpace);
            // Close with the terminator this script actually uses; a Latin full
            // stop after Devanagari or CJK looks (and reads aloud) wrong.
            s = s.replace(/[,;:\s]+$/, '') + terminatorFor(s);
        }
        return s.trim();
    }

    // Synchronous cache peek — lets the UI render cached recaps instantly
    // (and without a key) while reserving fresh generation for recent matches.
    function getCachedRecap(matchId) {
        return _readRecaps()[String(matchId)] || null;
    }

    // ─── The one call ────────────────────────────────────────────────────────
    // packet: FactsEngine.factsPacket output. Resolves a line or null.
    //
    // options.spoken — drama packet destined for speech: uses SPOKEN_PROMPT,
    // a tighter deadline (the table is waiting), and no caching, since every
    // dramatic moment is its own one-off and repeats would be stale.
    async function commentate(packet, options = {}) {
        if (!packet || !packet.matchId) return null;
        if (!_fetch || modelBroken) return null;
        // Quota is spent — don't spend a request finding that out again. The
        // caller falls back to its template, exactly as it does with no key.
        if (isRateLimited()) return null;

        const spoken = !!options.spoken;
        const inflightKey = spoken ? `spoken:${packet.matchId}` : packet.matchId;

        // Listener-steered voice direction (spec § Listener controls). The
        // language matters most: the synthesiser speaks whatever language the
        // chosen voice has, so the words must be written to match.
        let systemPrompt = spoken ? SPOKEN_PROMPT : SYSTEM_PROMPT;
        if (spoken && (options.language || options.mood)) {
            const extra = [];
            if (options.mood) extra.push(options.mood);
            const langDirection = languageDirection(options.langCode, options.language);
            if (langDirection) extra.push(langDirection);
            systemPrompt = `${systemPrompt} ${extra.join(' ')}`;
        }

        // Cache first — cached lines don't need a key either. Spoken lines are
        // never cached.
        if (!spoken) {
            if (packet.kind === 'recap') {
                const cached = _readRecaps()[packet.matchId];
                if (cached) return cached;
            } else {
                const cached = liveCache.get(`${packet.matchId}:${packet.roundsPlayed}`);
                if (cached) return cached;
            }
        }

        const key = getKey();
        if (!key) return null;
        if (inflight.has(inflightKey)) return null;   // one at a time per match
        inflight.add(inflightKey);

        const deadline = spoken ? SPOKEN_TIMEOUT_MS : TIMEOUT_MS;
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), deadline) : null;

        try {
            const res = await _fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`,
                },
                body: JSON.stringify({
                    model: MODEL,
                    temperature: spoken ? 0.9 : 0.8,
                    // Enough room to finish a sentence; length is enforced
                    // below by trimming at a sentence boundary, because the
                    // model treats word limits as a suggestion and a hard
                    // token cap truncates mid-word ("plumm…"), which is worse
                    // out loud than a long line.
                    max_tokens: spoken ? 120 : 90,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: JSON.stringify(packet) },
                    ],
                }),
                signal: controller ? controller.signal : undefined,
            });

            if (!res.ok) {
                if (res.status === 401) keyRejected = true;
                if (res.status === 400 || res.status === 404) modelBroken = true;
                // Quota spent: start a cooldown so the next render doesn't
                // immediately try again, and so the UI can say why it is quiet.
                if (res.status === 429) _noteRateLimited(res);
                return null;   // everything else: skip this round quietly
            }

            const data = await res.json();
            let line = data?.choices?.[0]?.message?.content;
            if (typeof line !== 'string') return null;
            line = line.trim().replace(/^["'\s]+|["'\s]+$/g, '');
            if (!line) return null;

            if (spoken) {
                // Reject a line written in the wrong script — the caller's
                // template is correct by construction and sounds better than
                // romanised text through a native voice.
                if (options.langCode && !usesExpectedScript(line, options.langCode)) return null;

                const twoBeat = TWO_SENTENCE_MOMENTS.has(packet.moment);
                line = trimToFirstSentence(line,
                    twoBeat ? 2 : 1,
                    twoBeat ? EVENT_MAX_CHARS : SPOKEN_MAX_CHARS);
            } else if (line.length > MAX_LINE_CHARS) {
                line = line.slice(0, MAX_LINE_CHARS - 1) + '…';
            }

            if (spoken) {
                // Never cached — a spoken moment happens once.
            } else if (packet.kind === 'recap') {
                _writeRecap(packet.matchId, line);
            } else {
                liveCache.set(`${packet.matchId}:${packet.roundsPlayed}`, line);
            }
            return line;
        } catch (e) {
            return null;   // abort, network, JSON — all just mean "no line"
        } finally {
            if (timer) clearTimeout(timer);
            inflight.delete(inflightKey);
        }
    }

    // ─── Test hooks ──────────────────────────────────────────────────────────
    function _setFetch(fn) { _fetch = fn; }
    function _setStorage(s) { _storage = s; }
    function _setNow(fn) { _now = fn || (() => Date.now()); }
    function _reset() {
        liveCache.clear();
        inflight.clear();
        keyRejected = false;
        modelBroken = false;
        rateLimitedUntil = 0;
    }

    return {
        commentate, getCachedRecap,
        getKey, setKey, hasKey, wasKeyRejected,
        isRateLimited, rateLimitMinutesLeft,
        MODEL, ENDPOINT, TIMEOUT_MS, SPOKEN_TIMEOUT_MS, SYSTEM_PROMPT, SPOKEN_PROMPT,
        _setFetch, _setStorage, _setNow, _reset,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroqService;
}
