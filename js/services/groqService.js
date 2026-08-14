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
        'Keep each sentence under 25 words.',
        'Be genuinely funny: tease the risk, the greed, or the nerve.',
        'Use AT MOST two numbers from the packet, and copy them exactly.',
        'Never invent or derive statistics, swings, totals, records, or events —',
        'if a number is not in the packet, do not say it. Do not do arithmetic.',
        'It will be read aloud by a speech synthesiser: no markdown, no emoji,',
        'no quotes, no preamble, no stage directions. Just the sentence.',
    ].join(' ');

    // ─── Injectable environment (browser defaults, overridable in tests) ─────
    let _fetch = (typeof fetch !== 'undefined') ? fetch.bind(globalThis) : null;
    let _storage = (typeof localStorage !== 'undefined') ? localStorage : null;

    // ─── Session state ───────────────────────────────────────────────────────
    const liveCache = new Map();   // "matchId:roundCount" → line
    const inflight = new Set();    // matchId currently awaiting a response
    let keyRejected = false;       // a 401 this session; surfaced in settings
    let modelBroken = false;       // 4xx model error → stop quietly for the session

    // ─── Key management ──────────────────────────────────────────────────────
    function getKey() {
        try { return _storage ? (_storage.getItem(KEY_STORAGE) || null) : null; }
        catch (e) { return null; }
    }
    function setKey(key) {
        keyRejected = false;
        modelBroken = false;
        try {
            if (!_storage) return;
            if (key) _storage.setItem(KEY_STORAGE, key.trim());
            else _storage.removeItem(KEY_STORAGE);
        } catch (e) { /* storage full/blocked — feature just stays off */ }
    }
    function hasKey() { return !!getKey(); }
    function wasKeyRejected() { return keyRejected; }

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

    function usesExpectedScript(line, langCode) {
        const re = SCRIPT_RANGES[langCode];
        if (!re) return true;          // Latin-script languages need no check
        return re.test(String(line));
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

    function trimToFirstSentence(text, maxSentences = 1, maxChars = SPOKEN_MAX_CHARS) {
        // Collapse newlines — the model sometimes puts each sentence on its
        // own line, which is invisible on screen but reads as a stumble aloud.
        let s = String(text).replace(/\s+/g, ' ').trim();

        // Keep up to maxSentences complete sentences.
        let cut = 0, taken = 0;
        while (taken < maxSentences) {
            const rest = s.slice(cut);
            const idx = rest.search(/[.!?](\s|$)/);
            if (idx === -1) break;
            cut += idx + 1;
            taken++;
        }
        if (cut > 0) s = s.slice(0, cut);

        if (s.length > maxChars) {
            s = s.slice(0, maxChars);
            const lastSpace = s.lastIndexOf(' ');
            if (lastSpace > 40) s = s.slice(0, lastSpace);
            s = s.replace(/[,;:\s]+$/, '') + '.';
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

        const spoken = !!options.spoken;
        const inflightKey = spoken ? `spoken:${packet.matchId}` : packet.matchId;

        // Listener-steered voice direction (spec § Listener controls). The
        // language matters most: the synthesiser speaks whatever language the
        // chosen voice has, so the words must be written to match.
        let systemPrompt = spoken ? SPOKEN_PROMPT : SYSTEM_PROMPT;
        if (spoken && (options.language || options.mood)) {
            const extra = [];
            if (options.mood) extra.push(options.mood);
            if (options.language && options.language !== 'English') {
                // Native script matters: the synthesiser pronounces by script,
                // so romanised Hindi ("blind call kiya") is read as English
                // phonetics by a Hindi voice and sounds wrong.
                extra.push(`Write the line in ${options.language}, not English,`
                    + ` using the native script of ${options.language}`
                    + ' (never romanised or transliterated Latin letters).'
                    + ' Keep team names exactly as given, in their original spelling.'
                    + ' Write all numbers as words in that language.');
            }
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
                return null;   // 429 and everything else: skip this round quietly
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
    function _reset() {
        liveCache.clear();
        inflight.clear();
        keyRejected = false;
        modelBroken = false;
    }

    return {
        commentate, getCachedRecap,
        getKey, setKey, hasKey, wasKeyRejected,
        MODEL, ENDPOINT, TIMEOUT_MS, SPOKEN_TIMEOUT_MS, SYSTEM_PROMPT, SPOKEN_PROMPT,
        _setFetch, _setStorage, _reset,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroqService;
}
