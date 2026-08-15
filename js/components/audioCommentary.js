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

    const DEFAULT_PREFS = { lang: 'en', voiceURI: '', speed: 1, mood: 'hype' };
    let _prefs = null;

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
        return _prefs;
    }

    function setPrefs(patch) {
        const next = { ...getPrefs(), ...(patch || {}) };
        if (!MOODS[next.mood]) next.mood = DEFAULT_PREFS.mood;
        next.speed = clampSpeed(next.speed);
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

    // Anything other than English relies on the LLM for its wording, because
    // the offline templates in FactsEngine are English-only.
    function languageNeedsKey(code) { return code !== 'en'; }

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
            const match = voices.filter(v => (v.lang || '').toLowerCase().startsWith(lang.code));
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
        const inLang = voices.filter(v => (v.lang || '').toLowerCase().startsWith(prefs.lang));
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
        const template = FactsEngine.dramaTemplate(moment);   // English
        let line = template;
        let llmLine = null;

        if (GroqService.hasKey()) {
            try {
                llmLine = await GroqService.commentate(dramaPacket(moment), {
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
        return { spoken: ok, reason: ok ? moment.kind : 'speak-failed', line, drama: moment };
    }

    // The drama object, shaped for the LLM. Numbers only — same contract as
    // the on-screen packet: the model phrases, it never computes.
    function dramaPacket(drama) {
        return {
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
    }

    // ─── Test hooks ──────────────────────────────────────────────────────────
    function _setStorage(s) { _storage = s; _prefs = null; }
    function _setSpeech(synth, Utterance) {
        _synth = synth; _Utterance = Utterance;
        _voice = null; _voiceResolved = false;   // re-resolve against the new synth
    }
    function _reset() { spokenFor.clear(); startedFor.clear(); }
    function _resetPrefs() { _prefs = null; _voice = null; _voiceResolved = false; }

    return {
        announceRound, announceMatchStart, speak, stop, toggle,
        isEnabled, setEnabled, isSupported,
        dramaPacket, pickVoice,
        getPrefs, setPrefs, availableLanguages, voicesForLanguage, languageName,
        languageNeedsKey, languageReady,
        PROSODY, FEMALE_VOICE_HINTS, MOODS, LANGUAGES, DEFAULT_PREFS,
        _setStorage, _setSpeech, _reset, _resetPrefs,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioCommentary;
}
