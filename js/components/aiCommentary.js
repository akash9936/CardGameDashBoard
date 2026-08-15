/**
 * AI Commentary — DOM layer for the pundit line, win meter, and facts ticker.
 *
 * Spec: ai-commentary.md. Presentation only:
 *   - decorateMatchCards()  — win meter on live cards (always), AI pundit line
 *                             on live/completed strips (only when a key is set)
 *   - mountTicker()         — rotating computed fun-facts on the Stats page
 *   - openSettings()        — paste/clear the BYO Groq key (localStorage)
 *
 * Depends on: FactsEngine, GroqService, StatsUtils, showModal (app.js).
 * Everything degrades silently: no key / no Groq → today's UI, untouched.
 */
const AICommentary = (() => {
    // Only the N most recent completed matches get a fresh recap generated;
    // older ones show a recap only if one is already cached. Keeps a cold
    // page load at ≤ 3 Groq calls instead of one per historical match.
    const RECENT_RECAPS = 3;
    const TICKER_INTERVAL_MS = 7000;

    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─── Win meter (deterministic — needs no key, spec §2) ───────────────────
    function renderWinMeter(match, teams, matches) {
        const prob = FactsEngine.winProbability(match, matches);
        const p1 = Math.round(prob.team1 * 100);
        const p2 = 100 - p1;
        const c1 = StatsUtils.teamColor(match.team1Id);
        const c2 = StatsUtils.teamColor(match.team2Id);
        const n1 = escape(nameOf(teams, match.team1Id));
        const n2 = escape(nameOf(teams, match.team2Id));
        return `
            <div class="win-meter" role="img"
                 aria-label="Win probability: ${n1} ${p1}%, ${n2} ${p2}%">
                <span class="wm-pct" style="color:${c1}">${p1}%</span>
                <div class="wm-bar">
                    <span class="wm-fill" style="width:${p1}%; background:${c1}"></span>
                    <span class="wm-fill" style="width:${p2}%; background:${c2}"></span>
                </div>
                <span class="wm-pct" style="color:${c2}">${p2}%</span>
                <span class="wm-caption">win probability · simulated from season history</span>
            </div>
        `;
    }

    function nameOf(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : 'Team';
    }

    // ─── Card decoration (called after refreshMatchesList renders) ───────────
    // Idempotent per render: the innerHTML swap wipes previous decorations.
    function decorateMatchCards(matches, teams) {
        let recapBudget = RECENT_RECAPS;

        for (const match of (matches || [])) {
            const card = document.querySelector(`.match-card[data-match-id="${CSS.escape(String(match.id))}"]`);
            if (!card) continue;

            // 1) Win meter on live matches — deterministic, always on.
            if (match.status === 'in_progress' && !card.querySelector('.win-meter')) {
                const strip = card.querySelector('.broadcast-strip');
                const html = renderWinMeter(match, teams, matches);
                if (strip) strip.insertAdjacentHTML('afterend', html);
                else card.insertAdjacentHTML('afterbegin', html);
            }

            // 2) Pundit line — needs a key (or a cached recap line).
            if (match.status !== 'in_progress' && match.status !== 'completed') continue;
            const body = card.querySelector('.broadcast-strip .bs-body');
            if (!body || body.querySelector('.bs-pundit')) continue;

            const isRecap = match.status === 'completed';
            if (isRecap) {
                // A cached recap renders instantly, costs nothing, needs no key.
                const cached = GroqService.getCachedRecap(match.id);
                if (cached) {
                    insertPunditLine(body, cached);
                    continue;
                }
                // Fresh recaps only for the most recent few (spec: cold page
                // load stays at ≤ RECENT_RECAPS Groq calls, not one per match).
                if (!GroqService.hasKey() || recapBudget <= 0) continue;
                recapBudget--;
            } else if (!GroqService.hasKey()) {
                continue;
            }

            const packet = FactsEngine.factsPacket(match, teams, matches);
            GroqService.commentate(packet).then(line => {
                if (!line) return;
                // The card may have re-rendered while we waited — re-resolve.
                const freshBody = document.querySelector(
                    `.match-card[data-match-id="${CSS.escape(String(match.id))}"] .broadcast-strip .bs-body`);
                if (freshBody) insertPunditLine(freshBody, line);
            });
        }
    }

    function insertPunditLine(bodyEl, line) {
        if (!bodyEl || bodyEl.querySelector('.bs-pundit')) return;
        bodyEl.insertAdjacentHTML('beforeend', `
            <div class="bs-line bs-pundit">
                <span class="bs-text">${escape(line)}</span>
                <span class="bs-label">AI ✨</span>
            </div>
        `);
    }

    // ─── Fun-facts ticker (Stats page — computed, no key needed) ─────────────
    let _tickerTimer = null;
    let _tickerIndex = 0;

    function mountTicker(teams, matches) {
        const host = document.getElementById('aiFactsTicker');
        if (!host) return;

        const live = (matches || []).find(m => m.status === 'in_progress') || null;
        const facts = FactsEngine.funFacts(teams, matches, live);

        if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
        if (!facts.length) { host.innerHTML = ''; return; }

        _tickerIndex = 0;
        host.innerHTML = `
            <div class="ai-ticker" aria-live="polite">
                <span class="ai-ticker-icon"></span>
                <span class="ai-ticker-text"></span>
            </div>
        `;
        const iconEl = host.querySelector('.ai-ticker-icon');
        const textEl = host.querySelector('.ai-ticker-text');

        const show = i => {
            const f = facts[i % facts.length];
            iconEl.textContent = f.icon;
            textEl.textContent = f.text;   // textContent — no HTML path
            textEl.classList.remove('ai-ticker-fade');
            void textEl.offsetWidth;       // restart the fade animation
            textEl.classList.add('ai-ticker-fade');
        };
        show(0);

        _tickerTimer = setInterval(() => {
            if (host.matches(':hover')) return;   // pause on hover
            _tickerIndex++;
            show(_tickerIndex);
        }, TICKER_INTERVAL_MS);
    }

    // ─── Voice controls (spec § Listener controls) ───────────────────────────
    // Rendered inside the settings dialog. Every control writes straight
    // through to AudioCommentary.setPrefs and previews immediately, so the
    // user hears the change rather than imagining it.
    function renderVoiceControls() {
        if (typeof AudioCommentary === 'undefined' || !AudioCommentary.isSupported()) {
            return `<p class="ai-settings-sub">This browser has no speech synthesis, so spoken
                    commentary is unavailable. Chrome, Safari and Edge all support it.</p>`;
        }

        const prefs = AudioCommentary.getPrefs();
        const langs = AudioCommentary.availableLanguages();
        const voices = AudioCommentary.voicesForLanguage(prefs.lang);
        const on = AudioCommentary.isEnabled();

        // Voices load asynchronously; if the list is empty the panel says so
        // rather than rendering two empty dropdowns.
        if (!langs.length) {
            return `<p class="ai-settings-sub">Loading voices from your system — reopen this
                    dialog in a moment.</p>`;
        }

        const keyed = GroqService.hasKey();
        const langOptions = langs.map(l => {
            // Flag what won't work yet, rather than letting someone pick a
            // language that will silently stay quiet.
            const needsKey = AudioCommentary.languageNeedsKey(l.code) && !keyed;
            const suffix = needsKey ? ' — needs Groq key' : '';
            return `<option value="${escape(l.code)}"${l.code === prefs.lang ? ' selected' : ''}>
                        ${escape(l.name)} (${l.voices.length})${suffix}
                    </option>`;
        }).join('');

        const voiceOptions = [`<option value=""${!prefs.voiceURI ? ' selected' : ''}>Auto — pick a female voice</option>`]
            .concat(voices.map(v => {
                const id = v.voiceURI || v.name;
                return `<option value="${escape(id)}"${id === prefs.voiceURI ? ' selected' : ''}>
                            ${escape(v.name)}
                        </option>`;
            })).join('');

        const moodButtons = Object.entries(AudioCommentary.MOODS).map(([key, m]) =>
            `<button type="button" class="ai-mood${key === prefs.mood ? ' active' : ''}"
                     data-mood="${escape(key)}">${escape(m.label)}</button>`).join('');

        return `
            <div class="ai-voice-panel">
                <div class="ai-voice-head">
                    <h3>🔊 Spoken commentary</h3>
                    <button type="button" id="aiAudioToggle"
                            class="ai-switch${on ? ' on' : ''}" aria-pressed="${on}">
                        ${on ? 'On' : 'Off'}
                    </button>
                </div>
                <p class="ai-settings-sub">
                    Narrates the match start, every round, and the finish. Uses your device's
                    built-in voices — no key needed. A Groq key just makes the words funnier.
                </p>

                <label class="ai-field">
                    <span>Language</span>
                    <select id="aiLangSelect">${langOptions}</select>
                </label>
                ${AudioCommentary.languageReady()
                    ? `<p class="ai-field-hint">
                           Commentary is written in this language too, so the words match the voice.
                       </p>`
                    : `<p class="ai-settings-error">
                           ⚠️ ${escape(AudioCommentary.languageName(prefs.lang))} needs a Groq key —
                           the built-in phrasing is English only, and an English sentence read by a
                           ${escape(AudioCommentary.languageName(prefs.lang))} voice sounds wrong, so
                           those moments stay silent. Add a key below, or switch back to English.
                       </p>`}

                <label class="ai-field">
                    <span>Voice</span>
                    <select id="aiVoiceSelect">${voiceOptions}</select>
                </label>

                <label class="ai-field">
                    <span>Speed</span>
                    <input type="range" id="aiSpeedRange" min="0.7" max="1.4" step="0.05"
                           value="${prefs.speed}">
                    <output id="aiSpeedOut">${Number(prefs.speed).toFixed(2)}×</output>
                </label>

                <div class="ai-field ai-field-block">
                    <span>Mood</span>
                    <div class="ai-mood-row">${moodButtons}</div>
                </div>

                <div class="ai-preview-row">
                    <button type="button" id="aiPreviewBtn" class="action-btn">▶ Preview</button>
                    <button type="button" id="aiPreviewDrama" class="action-btn secondary">🕶️ Preview a blind call</button>
                </div>
            </div>
            <hr class="ai-divider">
        `;
    }

    // Sample lines per language so Preview demonstrates the actual voice
    // rather than reading English through a non-English synthesiser.
    const PREVIEW_LINES = {
        en: 'KorbaGang called blind and landed it. A hundred and forty points, and the lead.',
        hi: 'कोरबागैंग ने ब्लाइंड खेला और जीत लिया। एक सौ चालीस अंक, और अब बढ़त उनकी है।',
        es: 'KorbaGang jugó a ciegas y acertó. Ciento cuarenta puntos, y la delantera.',
        fr: 'KorbaGang a joué à l\'aveugle et a réussi. Cent quarante points, et la tête.',
        de: 'KorbaGang ging blind und hat es geschafft. Hundertvierzig Punkte, und die Führung.',
        it: 'KorbaGang ha giocato al buio e ce l\'ha fatta. Centoquaranta punti, e il vantaggio.',
        pt: 'KorbaGang jogou às cegas e conseguiu. Cento e quarenta pontos, e a liderança.',
        ta: 'கோர்பாகேங் கண்மூடித்தனமாக விளையாடி வென்றது. நூற்று நாற்பது புள்ளிகள்.',
        te: 'కోర్బాగ్యాంగ్ బ్లైండ్ ఆడి గెలిచింది. నూట నలభై పాయింట్లు.',
        bn: 'কোরবাগ্যাং ব্লাইন্ড খেলে জিতেছে। একশো চল্লিশ পয়েন্ট।',
    };

    function previewLine() {
        const prefs = AudioCommentary.getPrefs();
        return PREVIEW_LINES[prefs.lang] || PREVIEW_LINES.en;
    }

    // Re-render the dialog in place after a change that alters its options
    // (a new language means a new voice list).
    function refreshSettingsDialog() {
        const host = document.querySelector('.ai-settings');
        if (!host) return;
        openSettings();
    }

    function wireVoiceControls() {
        const toggle = document.getElementById('aiAudioToggle');
        toggle?.addEventListener('click', () => {
            AudioCommentary.toggle();
            refreshSettingsDialog();
            if (typeof syncAudioToggleButton === 'function') syncAudioToggleButton();
        });

        document.getElementById('aiLangSelect')?.addEventListener('change', e => {
            AudioCommentary.setPrefs({ lang: e.target.value, voiceURI: '' });
            refreshSettingsDialog();
            AudioCommentary.speak(previewLine(), 'medium');
        });

        document.getElementById('aiVoiceSelect')?.addEventListener('change', e => {
            AudioCommentary.setPrefs({ voiceURI: e.target.value });
            AudioCommentary.speak(previewLine(), 'medium');
        });

        const speed = document.getElementById('aiSpeedRange');
        speed?.addEventListener('input', e => {
            const v = Number(e.target.value);
            const out = document.getElementById('aiSpeedOut');
            if (out) out.textContent = `${v.toFixed(2)}×`;
            AudioCommentary.setPrefs({ speed: v });
        });
        // Preview on release, not on every pixel of the drag.
        speed?.addEventListener('change', () => AudioCommentary.speak(previewLine(), 'medium'));

        document.querySelectorAll('.ai-mood').forEach(btn => {
            btn.addEventListener('click', () => {
                AudioCommentary.setPrefs({ mood: btn.getAttribute('data-mood') });
                document.querySelectorAll('.ai-mood').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                AudioCommentary.speak(previewLine(), 'medium');
            });
        });

        document.getElementById('aiPreviewBtn')?.addEventListener('click', () => {
            AudioCommentary.speak(previewLine(), 'medium');
        });

        // A real moment through the real path — template or LLM, whichever
        // applies — so the user hears exactly what a match will sound like.
        document.getElementById('aiPreviewDrama')?.addEventListener('click', async () => {
            const btn = document.getElementById('aiPreviewDrama');
            if (btn) { btn.disabled = true; btn.textContent = '…'; }
            try {
                const teams = await teamService.getAllTeams();
                const matches = await matchService.getAllMatches();
                const t1 = teams[0], t2 = teams[1];
                if (!t1 || !t2) { AudioCommentary.speak(previewLine(), 'high'); return; }
                const demo = {
                    id: `preview-${Date.now()}`,
                    team1Id: t1.id, team2Id: t2.id,
                    status: 'in_progress', date: new Date(),
                    finalScore: { team1: 430, team2: 395 },
                    rounds: [{
                        roundNumber: 1,
                        team1: { promise: 7, actual: 9, score: 140, blind: true },
                        team2: { promise: 5, actual: 4, score: -50, blind: false },
                    }],
                };
                AudioCommentary._reset();
                await AudioCommentary.announceRound(demo, null, teams, matches);
            } catch (e) {
                AudioCommentary.speak(previewLine(), 'high');
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = '🕶️ Preview a blind call'; }
            }
        });
    }

    // ─── Settings dialog (BYO key, spec § Security posture) ──────────────────
    function openSettings() {
        const hasKey = GroqService.hasKey();
        const rejected = GroqService.wasKeyRejected();
        const content = `
            <div class="ai-settings">
                <h2>🎙️ AI Commentary</h2>
                ${renderVoiceControls()}
                <h3>✨ Groq key (optional)</h3>
                <p class="ai-settings-sub">
                    Paste your own free Groq API key to get witty AI-written lines instead of
                    the built-in phrasing — on screen and out loud. The key is stored only in
                    this browser (localStorage) and sent only to api.groq.com. Without a key,
                    everything still works: win meter, fun facts, and spoken commentary using
                    the built-in templates.
                </p>
                <p class="ai-settings-sub">
                    Get a free key at
                    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com/keys</a>.
                </p>
                ${rejected ? '<p class="ai-settings-error">⚠️ The saved key was rejected by Groq — paste a new one.</p>' : ''}
                <p class="ai-settings-status">
                    Status: ${hasKey ? (rejected ? '🔴 key rejected' : '🟢 key configured') : '⚪ no key — AI lines off'}
                </p>
                <div class="ai-settings-row">
                    <input type="password" id="aiGroqKeyInput" placeholder="gsk_…"
                           autocomplete="off" spellcheck="false">
                    <button id="aiGroqKeySave" class="action-btn">Save</button>
                    ${hasKey ? '<button id="aiGroqKeyClear" class="action-btn danger">Clear</button>' : ''}
                </div>
            </div>
        `;
        if (typeof showModal === 'function') showModal(content);
        else return;

        if (typeof AudioCommentary !== 'undefined') wireVoiceControls();

        document.getElementById('aiGroqKeySave')?.addEventListener('click', () => {
            const v = document.getElementById('aiGroqKeyInput')?.value?.trim();
            if (v) GroqService.setKey(v);
            if (typeof closeModal === 'function') closeModal();
        });
        document.getElementById('aiGroqKeyClear')?.addEventListener('click', () => {
            GroqService.setKey(null);
            if (typeof closeModal === 'function') closeModal();
        });
    }

    return { decorateMatchCards, mountTicker, openSettings, renderWinMeter };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AICommentary;
}
