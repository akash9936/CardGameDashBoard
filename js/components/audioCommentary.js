/**
 * Audio Commentary — the table laptop speaks the dramatic moments.
 *
 * Spec: ai-commentary.md § Spoken commentary. Locked behaviour:
 *   - Only dramatic rounds get a voice (FactsEngine.dramaOf decides).
 *     Routine rounds are silent; silence is what makes the moments land.
 *   - OFF by default, one toggle. Nobody's laptop starts talking unprompted.
 *   - Speaks each round at most once, ever — re-renders, reloads and snapshot
 *     echoes never re-speak, and history is never narrated.
 *   - Web Speech API: free, local, no key, works offline. The LLM only makes
 *     the line funnier; a hand-written template speaks when it can't.
 *
 * Depends on: FactsEngine, GroqService. Degrades to silence everywhere.
 */
const AudioCommentary = (() => {
    const STORAGE_KEY = 'aiCommentary.audio';
    const PREFS_KEY = 'aiCommentary.audioPrefs';

    // Comedy vocabulary, anti-repetition state, and the transcript of what was
    // said. All three are optional: without them the commentary still speaks,
    // it just loses its steering and isn't kept.
    //
    // Resolution is by BARE NAME first, not `globalThis.X`. These siblings are
    // classic scripts whose top-level `const` lands in *script scope*, which is
    // reachable by name but is NOT a property of globalThis — so a
    // `globalThis.ComedyLibrary` probe reports "missing" in the browser and
    // silently disables the steering. Node has no such binding and require()
    // supplies it there. Declaring `const ComedyLibrary = …` here would also
    // shadow the very name being tested, so the aliases are underscored.
    const _comedy = (typeof ComedyLibrary !== 'undefined')
        ? ComedyLibrary
        : (typeof require === 'function' ? require('../data/comedyLibrary.js') : undefined);
    const _memory = (typeof CommentaryMemory !== 'undefined')
        ? CommentaryMemory
        : (typeof require === 'function' ? require('../utils/commentaryMemory.js') : undefined);
    const _log = (typeof CommentaryLog !== 'undefined')
        ? CommentaryLog
        : (typeof require === 'function' ? require('../utils/commentaryLog.js') : undefined);

    // Rounds already spoken this session — "matchId:roundNumber".
    const spokenFor = new Set();

    // Match-start lines already spoken — "start:matchId".
    const startedFor = new Set();

    // ─── Listener preferences (spec § Listener controls) ─────────────────────
    // Everything the user can steer from the in-app panel. Stored per device.
    //
    //   lang   — BCP-47 prefix ('en', 'hi', …). Chooses the voice pool AND the
    //            language the LLM writes in, so the words match the voice.
    //   voiceURI — a specific voice within that language, '' = auto-pick.
    //   speed  — multiplier applied on top of the per-moment rate (0.7–1.4).
    //   mood   — persona: changes both prosody and the prompt's attitude.
    const MOODS = {
        hype:      { label: 'Hype',      rate: 1.10, pitch: 1.12,
                     prompt: 'Be loud, breathless and thrilled — a big-match commentator who cannot sit still.' },
        classic:   { label: 'Classic',   rate: 1.00, pitch: 1.00,
                     prompt: 'Be a polished broadcast commentator: warm, measured, professional.' },
        sarcastic: { label: 'Sarcastic', rate: 0.98, pitch: 0.96,
                     prompt: 'Be dry and deadpan — sardonic wit, gentle mockery, never shouting.' },
        calm:      { label: 'Calm',      rate: 0.92, pitch: 0.98,
                     prompt: 'Be relaxed and understated, like late-night radio. Quiet amusement, no hype.' },
    };

    // Languages we offer when the device has a voice for them. Name is what
    // the LLM is told to write in.
    //
    // `needsKey: true` marks languages the app can only speak with a Groq key,
    // because the built-in templates are English-only. Without a key those
    // entries are still listed but flagged in the picker, so nobody picks
    // Hindi and hears an English sentence read by a Hindi voice.
    const LANGUAGES = [
        { code: 'en', name: 'English' },
        // The house register (commentary-style.md §6). Latin script, Hindi
        // grammar — so it borrows the Hindi voice pool to pronounce it.
        { code: 'hinglish', name: 'Hinglish', voiceCode: 'hi' },
        { code: 'hi', name: 'Hindi' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'it', name: 'Italian' },
        { code: 'pt', name: 'Portuguese' },
        { code: 'nl', name: 'Dutch' },
        { code: 'ru', name: 'Russian' },
        { code: 'ar', name: 'Arabic' },
        { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' },
        { code: 'zh', name: 'Chinese' },
        { code: 'ta', name: 'Tamil' },
        { code: 'te', name: 'Telugu' },
        { code: 'bn', name: 'Bengali' },
        { code: 'kn', name: 'Kannada' },
        { code: 'tr', name: 'Turkish' },
        { code: 'pl', name: 'Polish' },
        { code: 'sv', name: 'Swedish' },
        { code: 'id', name: 'Indonesian' },
        { code: 'th', name: 'Thai' },
        { code: 'vi', name: 'Vietnamese' },
    ];

    //   roastIntensity — how hard the humour is allowed to bite:
    //                    1 mild · 2 normal banter · 3 savage. Caps which
    //                    comedy-library phrases are offered (CLAUDE.md §0 —
    //                    four friends, so 2 is a fair default, not 1).
    const DEFAULT_PREFS = { lang: 'en', voiceURI: '', speed: 1, mood: 'hype', roastIntensity: 2 };
    let _prefs = null;

    function clampIntensity(n) {
        const v = Math.round(Number(n));
        if (!Number.isFinite(v)) return DEFAULT_PREFS.roastIntensity;
        return Math.min(3, Math.max(1, v));
    }

    function getPrefs() {
        if (_prefs) return _prefs;
        let stored = {};
        try {
            const raw = _storage ? _storage.getItem(PREFS_KEY) : null;
            stored = raw ? JSON.parse(raw) : {};
        } catch (e) { stored = {}; }
        _prefs = { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
        if (!MOODS[_prefs.mood]) _prefs.mood = DEFAULT_PREFS.mood;
        _prefs.speed = clampSpeed(_prefs.speed);
        _prefs.roastIntensity = clampIntensity(_prefs.roastIntensity);
        return _prefs;
    }

    function setPrefs(patch) {
        const next = { ...getPrefs(), ...(patch || {}) };
        if (!MOODS[next.mood]) next.mood = DEFAULT_PREFS.mood;
        next.speed = clampSpeed(next.speed);
        next.roastIntensity = clampIntensity(next.roastIntensity);
        // A language change invalidates the resolved voice unless the user
        // picked a specific one that still belongs to that language.
        if (patch && patch.lang && patch.lang !== _prefs.lang && !patch.voiceURI) {
            next.voiceURI = '';
        }
        _prefs = next;
        _voice = null; _voiceResolved = false;
        try { if (_storage) _storage.setItem(PREFS_KEY, JSON.stringify(next)); }
        catch (e) { /* storage blocked — prefs stay in memory */ }
        return next;
    }

    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

    function clampSpeed(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 1;
        return Math.min(1.4, Math.max(0.7, n));
    }

    function languageName(code) {
        const hit = LANGUAGES.find(l => l.code === code);
        return hit ? hit.name : 'English';
    }

    // Which OS voice pool a language draws from. Normally the language code IS
    // the voice tag, but Hinglish is a register rather than a locale: there is
    // no "hinglish" voice on any device, and the words are romanised Hindi, so
    // a Hindi voice pronounces them correctly. An English voice would read
    // "gaya" as "guy-uh".
    function voiceCodeFor(code) {
        const hit = LANGUAGES.find(l => l.code === code);
        return (hit && hit.voiceCode) || code;
    }

    // Anything other than English relies on the LLM for its wording, because
    // the offline templates in FactsEngine are English-only.
    // A language needs a Groq key when nothing local can produce words in it.
    // English and Hinglish both have hand-written templates
    // (FactsEngine.dramaTemplate), so they speak with no key and no network —
    // the LLM only makes them funnier. Everything else would be spoken in the
    // wrong language, and a native voice reading English is worse than silence.
    const TEMPLATED_LANGS = new Set(['en', 'hinglish']);
    function languageNeedsKey(code) { return !TEMPLATED_LANGS.has(code); }

    // True when the current settings can actually produce speech in the
    // chosen language. Drives the warning in the settings panel.
    function languageReady(code = getPrefs().lang) {
        return !languageNeedsKey(code) || GroqService.hasKey();
    }

    // Voices on this device, grouped for the picker: [{code, name, voices[]}].
    // Only languages the device can actually speak are offered.
    function availableLanguages() {
        if (!_synth || typeof _synth.getVoices !== 'function') return [];
        const voices = _synth.getVoices() || [];
        const out = [];
        for (const lang of LANGUAGES) {
            const tag = voiceCodeFor(lang.code);
            const match = voices.filter(v => (v.lang || '').toLowerCase().startsWith(tag));
            if (match.length) out.push({ ...lang, voices: match });
        }
        return out;
    }

    // macOS ships a set of novelty voices (Bubbles, Trinoids, Bad News…) that
    // are unusable for commentary. They stay selectable — someone will want
    // "Bad News" for a losing streak — but sort to the bottom and never win
    // the auto-pick.
    const NOVELTY_VOICES = [
        'bad news', 'good news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
        'jester', 'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
        'albert', 'fred', 'junior', 'kathy', 'ralph', 'grandma', 'grandpa',
        'rocko', 'sandy', 'shelley', 'reed', 'flo', 'eddy',
    ];

    function isNovelty(voice) {
        const n = (voice?.name || '').toLowerCase();
        return NOVELTY_VOICES.some(x => n.includes(x));
    }

    function voicesForLanguage(code) {
        const entry = availableLanguages().find(l => l.code === code);
        if (!entry) return [];
        // Natural voices first, novelties last; alphabetical within each group.
        return entry.voices.slice().sort((a, b) => {
            const na = isNovelty(a), nb = isNovelty(b);
            if (na !== nb) return na ? 1 : -1;
            return (a.name || '').localeCompare(b.name || '');
        });
    }

    // ─── Voice: female, commentary delivery (product decision) ───────────────
    // Voice availability is OS-dependent, so we rank by name against the
    // voices macOS / Windows / Android / iOS actually ship, then fall back to
    // any voice whose metadata says female, then to the default voice.
    const FEMALE_VOICE_HINTS = [
        // macOS / iOS
        'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison', 'ava', 'susan',
        // Windows
        'zira', 'hazel', 'eva', 'catherine', 'linda',
        // Chrome / Android / Google
        'google uk english female', 'google us english', 'english female', 'female',
    ];

    let _voice = null;          // resolved SpeechSynthesisVoice
    let _voiceResolved = false;

    function pickVoice() {
        if (_voiceResolved && _voice) return _voice;
        if (!_synth || typeof _synth.getVoices !== 'function') return null;

        const voices = _synth.getVoices() || [];
        if (!voices.length) return null;   // not loaded yet; retry on next speak

        const prefs = getPrefs();

        // An explicit choice wins outright.
        if (prefs.voiceURI) {
            const chosen = voices.find(v => v.voiceURI === prefs.voiceURI || v.name === prefs.voiceURI);
            if (chosen) { _voice = chosen; _voiceResolved = true; return _voice; }
            // The device no longer has it (different machine, OS update) —
            // fall through and auto-pick for the chosen language.
        }

        // Otherwise auto-pick a female voice in the chosen language, ignoring
        // the OS novelty voices.
        const inLang = voices.filter(v =>
            (v.lang || '').toLowerCase().startsWith(voiceCodeFor(prefs.lang)));
        const base = inLang.length ? inLang : voices.filter(v => /^en/i.test(v.lang || ''));
        const natural = base.filter(v => !isNovelty(v));
        const pool = natural.length ? natural : base;
        if (!pool.length) { _voice = voices[0] || null; _voiceResolved = true; return _voice; }

        for (const hint of FEMALE_VOICE_HINTS) {
            const hit = pool.find(v => (v.name || '').toLowerCase().includes(hint));
            if (hit) { _voice = hit; _voiceResolved = true; return _voice; }
        }
        // Some engines expose gender metadata; honour it when present.
        const tagged = pool.find(v => /female/i.test(v.gender || v.voiceURI || ''));
        _voice = tagged || pool[0] || null;
        _voiceResolved = true;
        return _voice;
    }

    // Delivery per drama tier — a commentator does not read a routine round
    // the way they call a blind at match point.
    const PROSODY = {
        finale: { rate: 1.02, pitch: 1.12 },   // match start / match won
        high:   { rate: 1.12, pitch: 1.18 },   // excited
        medium: { rate: 1.06, pitch: 1.08 },
        low:    { rate: 1.0,  pitch: 1.0 },    // matter-of-fact
    };

    let _storage = (typeof localStorage !== 'undefined') ? localStorage : null;
    let _synth = (typeof speechSynthesis !== 'undefined') ? speechSynthesis : null;
    let _Utterance = (typeof SpeechSynthesisUtterance !== 'undefined') ? SpeechSynthesisUtterance : null;

    // ─── Toggle (off by default) ─────────────────────────────────────────────
    function isEnabled() {
        try { return !!_storage && _storage.getItem(STORAGE_KEY) === '1'; }
        catch (e) { return false; }
    }

    function setEnabled(on) {
        try {
            if (!_storage) return;
            if (on) _storage.setItem(STORAGE_KEY, '1');
            else _storage.removeItem(STORAGE_KEY);
        } catch (e) { /* storage blocked — feature stays off */ }
        if (!on) stop();
    }

    function isSupported() { return !!_synth && !!_Utterance; }

    function toggle() {
        const next = !isEnabled();
        setEnabled(next);
        // The toggle click is the user gesture browsers require before audio
        // is allowed — greet on enable so the first real moment isn't the one
        // that gets swallowed by the autoplay policy.
        if (next) speak('Commentary on.', 'medium');
        return next;
    }

    function stop() {
        try { if (_synth) _synth.cancel(); } catch (e) { /* no-op */ }
    }

    // ─── Speaking ────────────────────────────────────────────────────────────
    function speak(text, level = 'low') {
        if (!isSupported() || !text) return false;
        try {
            // Cancel first so two quick rounds never talk over each other.
            _synth.cancel();
            const u = new _Utterance(String(text));

            // Delivery = the moment's tone × the listener's mood × their speed.
            // Clamped to the Web Speech legal range so an extreme combination
            // can't produce an unusable (or silent) utterance.
            const prefs = getPrefs();
            const tone = PROSODY[level] || PROSODY.low;
            const mood = MOODS[prefs.mood] || MOODS.hype;
            u.rate = clamp(tone.rate * mood.rate * prefs.speed, 0.5, 2);
            u.pitch = clamp(tone.pitch * mood.pitch, 0.5, 2);
            u.volume = 1.0;
            const v = pickVoice();
            if (v) { u.voice = v; if (v.lang) u.lang = v.lang; }
            _synth.speak(u);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ─── The one entry point ─────────────────────────────────────────────────
    // Called right after a round is submitted, with the freshly-loaded match.
    // prevMatch is the state *before* the round (may be null — dramaOf can
    // derive it by subtracting the round that just landed).
    //
    // Resolves { spoken: bool, reason, line } — the reason is useful in tests
    // and when debugging why the table stayed quiet.
    async function announceRound(match, prevMatch, teams, matches, options = {}) {
        if (!isEnabled()) return { spoken: false, reason: 'disabled' };
        if (!isSupported()) return { spoken: false, reason: 'unsupported' };
        if (!match || !Array.isArray(match.rounds) || !match.rounds.length) {
            return { spoken: false, reason: 'no-rounds' };
        }

        const roundKey = `${match.id}:${match.rounds.length}`;
        if (spokenFor.has(roundKey)) return { spoken: false, reason: 'already-spoken' };

        // Every round is narrated (product decision) — dramaOf always returns
        // a moment now, routine rounds included, and its level only chooses
        // the delivery. No frequency guard: the table wants running
        // commentary, and a match is at most ~12 rounds.
        const drama = FactsEngine.dramaOf(match, prevMatch, matches, teams, options);
        if (!drama) return { spoken: false, reason: 'no-moment' };

        // Claim the round before any await — a second call for the same round
        // (double submit, snapshot echo) must not queue a second utterance.
        spokenFor.add(roundKey);

        return deliver(drama);
    }

    // ─── Match start — spoken once, when a match begins ──────────────────────
    async function announceMatchStart(match, teams, matches, options = {}) {
        if (!isEnabled()) return { spoken: false, reason: 'disabled' };
        if (!isSupported()) return { spoken: false, reason: 'unsupported' };
        if (!match) return { spoken: false, reason: 'no-match' };

        const key = `start:${match.id}`;
        if (startedFor.has(key)) return { spoken: false, reason: 'already-spoken' };

        const moment = FactsEngine.matchStartMoment(match, teams, matches, options);
        if (!moment) return { spoken: false, reason: 'no-moment' };
        startedFor.add(key);

        return deliver(moment);
    }

    // Shared delivery path: template first (audio never depends on the
    // network), LLM line if it arrives in time, then speak in the tone the
    // moment deserves.
    async function deliver(moment) {
        const prefs = getPrefs();

        // Anti-repetition steering (commentary-style.md §8). Chosen here, up
        // front, so the same selection reaches the template, the LLM, and the
        // ledger — all three have to agree on which phrase was spent.
        const steer = comedySteer(moment);

        // Written in the listener's language when we have templates for it, so
        // a slow LLM degrades to the same voice rather than to a stats robot.
        // The steer goes in too: the template path is what actually speaks
        // whenever Groq is missing, slow, or out of quota, and it should draw
        // on the same rotating vocabulary the season facts board does.
        const template = FactsEngine.dramaTemplate(moment, { lang: prefs.lang, steer });
        let line = template;
        let llmLine = null;

        if (GroqService.hasKey()) {
            try {
                llmLine = await GroqService.commentate(dramaPacket(moment, steer), {
                    spoken: true,
                    // The voice speaks the chosen language, so the words must
                    // be written in it too — otherwise a Hindi voice reads
                    // English text with Hindi phonetics.
                    language: languageName(prefs.lang),
                    langCode: prefs.lang,
                    mood: (MOODS[prefs.mood] || MOODS.hype).prompt,
                });
                if (llmLine) line = llmLine;
            } catch (e) { /* fall through to the template */ }
        }

        // In a non-English language the template is the wrong language, and a
        // native voice reading English is worse than saying nothing. Skip this
        // moment rather than mispronounce it.
        if (languageNeedsKey(prefs.lang) && !llmLine) {
            return { spoken: false, reason: 'language-unavailable', drama: moment };
        }

        const ok = speak(line, moment.level);

        // Only a line that actually reached the speaker burns a phrase, a form
        // or an opening — a skipped moment must not consume the vocabulary.
        if (ok && steer) {
            _memory.record(moment.matchId, {
                phraseId: phraseUsedIn(line, steer),
                form: steer.form,
                intent: steer.intent,
                line,
            });
        }

        // Keep what was said, so it can be re-read later. Same condition as
        // above: a moment that never reached the speaker was never said, and
        // logging it would put a line in the transcript nobody heard.
        if (ok && _log) {
            _log.append(moment.matchId, {
                kind: moment.kind === 'match-start' ? 'start' : 'spoken',
                round: moment.roundNumber,
                text: line,
                actor: moment.actor,
                source: llmLine ? 'ai' : 'template',
            });
        }

        return { spoken: ok, reason: ok ? moment.kind : 'speak-failed', line, drama: moment };
    }

    // Choose this line's narrative intent, sentence shape, and a handful of
    // unused phrases — all in code, so rotation is enforced rather than
    // requested. Returns null when the libraries are unavailable (the feature
    // degrades to plain commentary, never to an error).
    function comedySteer(moment) {
        if (!_comedy || !_memory) return null;
        const intent = _comedy.intentFor(moment);
        if (!intent) return null;

        const mem = _memory.state(moment.matchId);
        const form = _memory.nextForm(moment.matchId, _comedy.forms());
        const options = _comedy.candidates(intent, {
            usedIds: mem.usedPhraseIds,
            maxIntensity: getPrefs().roastIntensity,
            limit: 5,
        });

        return {
            intent,
            form: form ? form.id : null,
            formHint: form ? form.hint : null,
            phrases: options.map(p => p.text),
            // The phrase the model is most likely to reach for. Recorded as
            // used even if the model rephrases it — the point is to keep the
            // drawer moving, not to police the wording.
            phraseId: options.length ? options[0].id : null,
            recentOpenings: mem.recentOpenings,
        };
    }

    // Which library phrase the spoken line actually used.
    //
    // The steer offers several candidates; the template always takes the first,
    // but the model is free to reach for any of them (or to invent its own
    // wording). Recording the offered phrase regardless was wrong in both
    // directions: it burned a phrase that was never said, and left the one the
    // model *did* say available to repeat next round — the exact repetition the
    // ledger exists to prevent.
    //
    // Matching is on the phrase text appearing in the line, because a phrase is
    // a closing beat inside a sentence, not the whole line. Bent forms
    // ("nipat gaye" → "nipat hi gaye") won't match and fall back to the offered
    // id: an approximate burn keeps the drawer moving, which beats recording
    // nothing and letting a phrase repeat forever.
    function phraseUsedIn(line, steer) {
        if (!steer) return null;
        if (!_comedy) return steer.phraseId || null;

        const hay = normalisePhrase(line);
        if (!hay) return steer.phraseId || null;

        // Only phrases this line was actually offered are candidates — a
        // coincidental match against the wider library would burn a phrase the
        // model never saw.
        const offered = (steer.phrases || [])
            .map(text => (_comedy.PHRASES || []).find(p => p.text === text))
            .filter(Boolean);

        // Longest first, so "aaj inka din hai" wins over a shorter phrase
        // nested inside it.
        const hit = offered
            .slice()
            .sort((a, b) => b.text.length - a.text.length)
            .find(p => hay.includes(normalisePhrase(p.text)));

        return hit ? hit.id : (steer.phraseId || null);
    }

    // Lowercased, punctuation-stripped, single-spaced — so "Nipat gaye." and
    // "nipat gaye" are the same phrase.
    function normalisePhrase(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // The drama object, shaped for the LLM. Numbers only — same contract as
    // the on-screen packet: the model phrases, it never computes.
    //
    // `steer` carries comedy direction, never facts: an intent label, a
    // sentence shape, a few candidate phrases, and the openings to avoid.
    function dramaPacket(drama, steer = null) {
        const packet = {
            kind: 'spoken',
            matchId: drama.matchId,
            moment: drama.kind,
            actor: drama.actor,
            headline: drama.headline,
            facts: drama.facts,
            score: drama.score,
            teams: drama.teams,
            roundNumber: drama.roundNumber,
        };
        // Two-sided round detail, when dramaOf supplied it (match-start has no
        // round yet).
        if (drama.round) packet.round = drama.round;
        if (steer) {
            packet.comedy = {
                intent: steer.intent,
                form: steer.form,
                formHint: steer.formHint,
                phrases: steer.phrases,
                avoidOpenings: steer.recentOpenings,
            };
        }
        return packet;
    }

    // ─── Test hooks ──────────────────────────────────────────────────────────
    function _setStorage(s) { _storage = s; _prefs = null; }
    function _setSpeech(synth, Utterance) {
        _synth = synth; _Utterance = Utterance;
        _voice = null; _voiceResolved = false;   // re-resolve against the new synth
    }
    function _reset() {
        spokenFor.clear();
        startedFor.clear();
        if (_memory) _memory._reset();
    }
    function _resetPrefs() { _prefs = null; _voice = null; _voiceResolved = false; }

    return {
        announceRound, announceMatchStart, speak, stop, toggle,
        isEnabled, setEnabled, isSupported,
        dramaPacket, pickVoice, comedySteer, phraseUsedIn,
        getPrefs, setPrefs, availableLanguages, voicesForLanguage, languageName,
        languageNeedsKey, languageReady,
        PROSODY, FEMALE_VOICE_HINTS, MOODS, LANGUAGES, DEFAULT_PREFS,
        _setStorage, _setSpeech, _reset, _resetPrefs,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioCommentary;
}
