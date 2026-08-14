global.Match = require('../js/models/Match.js');
const FactsEngine = require('../js/utils/factsEngine.js');
const GroqService = require('../js/services/groqService.js');

global.FactsEngine = FactsEngine;
global.GroqService = GroqService;
const AudioCommentary = require('../js/components/audioCommentary.js');

const TEAMS = [
    { id: 'A', name: 'Alpha' },
    { id: 'B', name: 'Bravo' },
];

// A live match whose rounds are supplied verbatim; finalScore is summed so
// the pre-round state can be derived by subtracting the last round.
function match(rounds, status = 'in_progress', overrides = {}) {
    const finalScore = rounds.reduce((acc, r) => ({
        team1: acc.team1 + Number(r.team1?.score || 0),
        team2: acc.team2 + Number(r.team2?.score || 0),
    }), { team1: 0, team2: 0 });
    return {
        id: 'live1', team1Id: 'A', team2Id: 'B',
        status, date: '2026-03-01', rounds, finalScore,
        winnerId: null, ...overrides,
    };
}

const round = (t1, t2, n = 1) => ({ roundNumber: n, team1: t1, team2: t2 });
const met = (p, a) => ({ promise: p, actual: a, score: Match.computeScore(p, a, {}), blind: false });
const blind = a => ({ promise: 7, actual: a, score: a >= 7 ? 140 : -70, blind: true });

// A blind only counts as drama when it was consequential — late in the match
// or with the scores close (spec § Tuning). Most fixtures below want a
// *consequential* blind, so pin the totals into late-game territory.
function lateMatch(rounds, overrides = {}) {
    const m = match(rounds, 'in_progress', overrides);
    // Push both teams near the win line without touching round data.
    m.finalScore = { team1: 400 + m.finalScore.team1, team2: 390 + m.finalScore.team2 };
    return m;
}

// ─── Drama detection ────────────────────────────────────────────────────────
describe('FactsEngine.dramaOf', () => {
    test('a routine round still gets narrated, at the low tier', () => {
        // Every round is spoken now; an ordinary round is reported plainly.
        const m = match([round(met(5, 5), met(8, 8))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('routine');
        expect(d.level).toBe('low');
        expect(d.headline).toMatch(/Bravo|Alpha/);
    });

    test('a routine blind mid-match is reported, but only at medium tier', () => {
        // Not late, not close — still narrated, just not shouted.
        const m = match([round(blind(8), met(5, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('blind-hit');
        expect(d.level).toBe('medium');
    });

    test('a consequential blind hit is high drama and names the actor', () => {
        const m = lateMatch([round(blind(8), met(5, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('blind-hit');
        expect(d.level).toBe('high');
        expect(d.actor).toBe('Alpha');
        expect(d.headline).toContain('landed it');
        expect(d.headline).toContain('+140');
    });

    test('a consequential blind miss is high drama', () => {
        const m = lateMatch([round(blind(4), met(9, 9))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('blind-miss');
        expect(d.headline).toContain('missed');
        expect(d.headline).toContain('−70');
    });

    test('a lead change fires when the match flips', () => {
        // After R1 Bravo lead 90 to −40. Alpha's blind (+140) puts them on
        // 100 against Bravo's 90+40=130 — still behind, so R2 alone is not a
        // flip. Give Bravo a losing round instead so the lead genuinely turns.
        const m = match([
            round(met(4, 3), met(9, 9), 1),      // A −40, B +90  → B ahead 90 to −40
            round(blind(9), met(9, 4), 2),       // A +140, B −90 → A ahead 100 to 0
        ]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        // The blind is also high — either may headline, but the lead change
        // must appear somewhere in what gets spoken.
        const all = [d.headline, ...d.facts].join(' ');
        expect(all).toContain('taken the lead');
    });

    test('no lead change when the leader stays the leader', () => {
        const m = lateMatch([
            round(met(9, 9), met(4, 3), 1),      // A +90, B −40 → A ahead
            round(blind(9), met(5, 5), 2),       // A +140, B +50 → A still ahead
        ]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect([d.headline, ...d.facts].join(' ')).not.toContain('taken the lead');
    });

    test('match point fires only on the round that crosses 450', () => {
        const below = match([round(met(13, 13), met(4, 0), 1)]);   // A 130
        expect(FactsEngine.dramaOf(below, null, [below], TEAMS)?.kind).not.toBe('match-point');

        // Crossing 450 this round.
        const crossing = {
            ...match([round(met(13, 13), met(4, 0), 1)]),
            finalScore: { team1: 460, team2: 100 },
        };
        const prev = { ...crossing, finalScore: { team1: 330, team2: 140 } };
        const d = FactsEngine.dramaOf(crossing, prev, [crossing], TEAMS);
        const all = [d.headline, ...d.facts].join(' ');
        expect(all).toContain('match point');
        expect(all).toContain('40 more points');
    });

    test('match point does not re-fire once already there', () => {
        const m = { ...match([round(met(5, 5), met(5, 5), 1)]), finalScore: { team1: 470, team2: 100 } };
        const prev = { ...m, finalScore: { team1: 460, team2: 95 } };   // already match point
        const d = FactsEngine.dramaOf(m, prev, [m], TEAMS);
        // Still narrated (every round is), but as a routine round — the
        // match-point trigger itself does not re-fire.
        expect(d.kind).not.toBe('match-point');
        expect(d.level).toBe('low');
    });

    test('over-extension is medium drama', () => {
        const m = match([round(met(4, 9), met(9, 4))]);   // A took 9 on a 4 promise
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('over-extension');
        expect(d.level).toBe('medium');
        expect(d.headline).toContain('double the promise');
    });

    test('a near-miss on a big promise is medium drama', () => {
        // A promise of 8+ hurts enough to mention on its own.
        const m = match([round(met(9, 8), met(4, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('near-miss');
        expect(d.headline).toContain('one hand short');
    });

    test('a near-miss on a small promise is narrated at the low tier', () => {
        const m = match([round(met(6, 5), met(8, 8))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('near-miss');
        expect(d.level).toBe('low');
    });

    test('high drama outranks medium in the headline', () => {
        // Alpha blind-hits (high) while Bravo over-extends (medium).
        const m = lateMatch([round(blind(9), met(4, 8))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.level).toBe('high');
        expect(d.kind).toBe('blind-hit');
        expect(d.facts.join(' ')).toContain('double the promise');
    });

    test('facts carry risk and chance context', () => {
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS, {
            winProbOptions: { iterations: 200, rng: () => 0.5 },
        });
        const joined = d.facts.join(' ');
        expect(joined).toMatch(/lead|win probability/);
        expect(d.score).toEqual({ t1: 540, t2: 440 });
    });

    test('blind history is quoted when the team has called before', () => {
        const past = match([round(blind(8), met(5, 5), 1)], 'completed', { id: 'past1', winnerId: 'A' });
        // Close scores make the blind consequential without triggering match
        // point, so the blind stays the headline and quotes its own history.
        const now = match([round(blind(3), met(10, 10), 1)]);
        now.finalScore = { team1: 200, team2: 240 };
        const d = FactsEngine.dramaOf(now, null, [past, now], TEAMS);
        expect(d.kind).toBe('blind-miss');
        expect(d.facts.join(' ')).toContain('called 2 blinds');
    });

    test('an empty match is never dramatic', () => {
        expect(FactsEngine.dramaOf(match([]), null, [], TEAMS)).toBeNull();
    });

    test('dramaTemplate produces a speakable line without the LLM', () => {
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        const line = FactsEngine.dramaTemplate(d);
        expect(typeof line).toBe('string');
        expect(line).toContain('Alpha');
        expect(line).not.toMatch(/[*_#`]/);   // nothing markdown-ish to read aloud
    });
});

// ─── Audio component ────────────────────────────────────────────────────────
function makeStorage() {
    const map = new Map();
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

function makeSynth() {
    const spoken = [];
    let cancels = 0;
    return {
        spoken, cancelCount: () => cancels,
        synth: {
            speak: u => spoken.push(u.text),
            cancel: () => { cancels++; },
        },
        Utterance: class { constructor(text) { this.text = text; } },
    };
}

describe('AudioCommentary', () => {
    let storage, speech;

    beforeEach(() => {
        storage = makeStorage();
        speech = makeSynth();
        AudioCommentary._setStorage(storage);
        AudioCommentary._setSpeech(speech.synth, speech.Utterance);
        AudioCommentary._reset();
        GroqService._setStorage(makeStorage());
        GroqService._reset();
        GroqService._setFetch(jest.fn(async () => { throw new Error('no network in test'); }));
    });

    test('is off by default and says nothing', async () => {
        expect(AudioCommentary.isEnabled()).toBe(false);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res).toEqual({ spoken: false, reason: 'disabled' });
        expect(speech.spoken).toEqual([]);
    });

    test('toggle turns it on, greets, and persists', () => {
        expect(AudioCommentary.toggle()).toBe(true);
        expect(AudioCommentary.isEnabled()).toBe(true);
        expect(speech.spoken).toEqual(['Commentary on.']);
        expect(storage.getItem('aiCommentary.audio')).toBe('1');

        expect(AudioCommentary.toggle()).toBe(false);
        expect(AudioCommentary.isEnabled()).toBe(false);
    });

    test('speaks a dramatic round when enabled', async () => {
        AudioCommentary.setEnabled(true);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(true);
        expect(res.reason).toBe('blind-hit');
        expect(speech.spoken.join(' ')).toContain('Alpha');
    });

    test('speaks on a routine round too — every round is narrated', async () => {
        AudioCommentary.setEnabled(true);
        const m = match([round(met(5, 5), met(8, 8))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(true);
        expect(res.reason).toBe('routine');
        expect(speech.spoken.length).toBe(1);
    });

    test('never speaks the same round twice (re-render, reload, echo)', async () => {
        AudioCommentary.setEnabled(true);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        const second = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(second).toEqual({ spoken: false, reason: 'already-spoken' });
        expect(speech.spoken.length).toBe(1);
    });

    test('cancels any in-flight speech before speaking', async () => {
        AudioCommentary.setEnabled(true);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(speech.cancelCount()).toBeGreaterThanOrEqual(1);
    });

    test('speaks the template when Groq is unavailable', async () => {
        AudioCommentary.setEnabled(true);
        GroqService.setKey('gsk_k');   // key set, but fetch throws
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(true);
        expect(res.line).toContain('Alpha');   // template, not silence
    });

    test('prefers the LLM line when Groq answers', async () => {
        AudioCommentary.setEnabled(true);
        GroqService.setKey('gsk_k');
        GroqService._setFetch(jest.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'Alpha went blind and the room lost it!' } }] }),
        })));
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.line).toBe('Alpha went blind and the room lost it!');
        expect(speech.spoken[0]).toBe('Alpha went blind and the room lost it!');
    });

    test('spoken requests use the spoken prompt and are not cached', async () => {
        AudioCommentary.setEnabled(true);
        GroqService.setKey('gsk_k');
        const fetch = jest.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'Line!' } }] }),
        }));
        GroqService._setFetch(fetch);

        const packet = AudioCommentary.dramaPacket({
            matchId: 'm1', kind: 'blind-hit', actor: 'Alpha', headline: 'h',
            facts: [], score: { t1: 1, t2: 2 }, teams: { t1: 'Alpha', t2: 'Bravo' }, roundNumber: 1,
        });
        await GroqService.commentate(packet, { spoken: true });
        await GroqService.commentate(packet, { spoken: true });

        expect(fetch).toHaveBeenCalledTimes(2);   // no caching for spoken lines
        const body = JSON.parse(fetch.mock.calls[0][1].body);
        expect(body.messages[0].content).toBe(GroqService.SPOKEN_PROMPT);
        expect(body.messages[0].content).toContain('read aloud');
    });

    test('disabling stops any speech in progress', () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.speak('something');
        const before = speech.cancelCount();
        AudioCommentary.setEnabled(false);
        expect(speech.cancelCount()).toBeGreaterThan(before);
    });

    // ── Every-round mode ─────────────────────────────────────────────────────
    test('narrates consecutive rounds — no cooldown any more', async () => {
        AudioCommentary.setEnabled(true);
        const r1 = round(blind(9), met(5, 5), 1);
        const r2 = round(blind(8), met(5, 5), 2);
        const m1 = lateMatch([r1]);
        const m2 = { ...lateMatch([r1, r2]), id: 'live1' };

        const a = await AudioCommentary.announceRound(m1, null, TEAMS, [m1]);
        const b = await AudioCommentary.announceRound(m2, m1, TEAMS, [m2]);
        expect(a.spoken).toBe(true);
        expect(b.spoken).toBe(true);
        expect(speech.spoken.length).toBe(2);
    });

    test('narrates a full 12-round match without capping', async () => {
        AudioCommentary.setEnabled(true);
        const rounds = [];
        let spokenCount = 0;
        for (let i = 1; i <= 12; i++) {
            rounds.push(round(met(5, 5), met(8, 8), i));
            const m = { ...match(rounds.slice()), id: 'twelve' };
            const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
            if (res.spoken) spokenCount++;
        }
        expect(spokenCount).toBe(12);
    });

    // ── Match start / end ────────────────────────────────────────────────────
    test('announces the match start once, at finale tier', async () => {
        AudioCommentary.setEnabled(true);
        const m = match([]);
        const first = await AudioCommentary.announceMatchStart(m, TEAMS, []);
        const second = await AudioCommentary.announceMatchStart(m, TEAMS, []);
        expect(first.spoken).toBe(true);
        expect(first.reason).toBe('match-start');
        expect(first.drama.level).toBe('finale');
        expect(second).toEqual({ spoken: false, reason: 'already-spoken' });
        expect(speech.spoken.length).toBe(1);
    });

    test('the finale glorifies the winner and roasts the loser', async () => {
        AudioCommentary.setEnabled(true);
        const rounds = [
            round(blind(9), met(4, 2), 1),
            round(met(5, 5), met(4, 9), 2),
        ];
        const done = {
            ...match(rounds, 'completed', { winnerId: 'A' }),
            finalScore: { team1: 510, team2: 120 },
        };
        const prev = { ...done, finalScore: { team1: 370, team2: 120 } };
        const res = await AudioCommentary.announceRound(done, prev, TEAMS, [done]);
        expect(res.spoken).toBe(true);
        expect(res.reason).toBe('match-end');
        expect(res.drama.level).toBe('finale');
        expect(res.line).toContain('Alpha have won it');
        // A roast fact about the loser is always present.
        expect(res.drama.facts.join(' ')).toContain('Bravo');
    });

    // ── Voice ────────────────────────────────────────────────────────────────
    test('prefers a female English voice when one is available', () => {
        AudioCommentary._setSpeech({
            speak: () => {}, cancel: () => {},
            getVoices: () => ([
                { name: 'Daniel', lang: 'en-GB' },
                { name: 'Samantha', lang: 'en-US' },
                { name: 'Amelie', lang: 'fr-FR' },
            ]),
        }, class { constructor(t) { this.text = t; } });
        expect(AudioCommentary.pickVoice().name).toBe('Samantha');
    });

    test('falls back to the first English voice when no female match', () => {
        AudioCommentary._setSpeech({
            speak: () => {}, cancel: () => {},
            getVoices: () => ([{ name: 'Xylo', lang: 'en-US' }, { name: 'Pierre', lang: 'fr-FR' }]),
        }, class { constructor(t) { this.text = t; } });
        expect(AudioCommentary.pickVoice().name).toBe('Xylo');
    });

    test('applies a livelier delivery to high drama than to routine', () => {
        const utterances = [];
        AudioCommentary._setSpeech({
            speak: u => utterances.push(u), cancel: () => {},
            getVoices: () => ([{ name: 'Samantha', lang: 'en-US' }]),
        }, class { constructor(t) { this.text = t; } });
        AudioCommentary.setEnabled(true);

        AudioCommentary.speak('routine line', 'low');
        AudioCommentary.speak('big moment', 'high');
        expect(utterances[1].rate).toBeGreaterThan(utterances[0].rate);
        expect(utterances[1].pitch).toBeGreaterThan(utterances[0].pitch);
        expect(utterances[0].voice.name).toBe('Samantha');
    });

    test('reports unsupported when the browser has no speech synthesis', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary._setSpeech(null, null);
        expect(AudioCommentary.isSupported()).toBe(false);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res).toEqual({ spoken: false, reason: 'unsupported' });
    });
});

// ─── Listener controls: language, voice, speed, mood ────────────────────────
describe('AudioCommentary preferences', () => {
    let storage, speech;

    const VOICES = [
        { name: 'Daniel', lang: 'en-GB', voiceURI: 'daniel' },
        { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha' },
        { name: 'Bubbles', lang: 'en-US', voiceURI: 'bubbles' },   // novelty
        { name: 'Lekha', lang: 'hi-IN', voiceURI: 'lekha' },
        { name: 'Mónica', lang: 'es-ES', voiceURI: 'monica' },
    ];

    function makeStore() {
        const map = new Map();
        return {
            getItem: k => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, String(v)),
            removeItem: k => map.delete(k),
        };
    }

    beforeEach(() => {
        storage = makeStore();
        const spoken = [];
        speech = {
            spoken,
            synth: { speak: u => spoken.push(u), cancel: () => {}, getVoices: () => VOICES },
            Utterance: class { constructor(t) { this.text = t; } },
        };
        AudioCommentary._setStorage(storage);
        AudioCommentary._setSpeech(speech.synth, speech.Utterance);
        AudioCommentary._reset();
        AudioCommentary._resetPrefs();
        GroqService._setStorage(makeStore());
        GroqService._reset();
    });

    test('defaults to English, auto voice, normal speed, hype mood', () => {
        expect(AudioCommentary.getPrefs()).toEqual({
            lang: 'en', voiceURI: '', speed: 1, mood: 'hype',
        });
    });

    test('preferences persist through storage', () => {
        AudioCommentary.setPrefs({ lang: 'es', mood: 'calm', speed: 1.2 });
        AudioCommentary._resetPrefs();          // simulate a page reload
        const prefs = AudioCommentary.getPrefs();
        expect(prefs.lang).toBe('es');
        expect(prefs.mood).toBe('calm');
        expect(prefs.speed).toBe(1.2);
    });

    test('speed is clamped to a usable range', () => {
        expect(AudioCommentary.setPrefs({ speed: 9 }).speed).toBe(1.4);
        expect(AudioCommentary.setPrefs({ speed: 0.1 }).speed).toBe(0.7);
        expect(AudioCommentary.setPrefs({ speed: 'nonsense' }).speed).toBe(1);
    });

    test('an unknown mood falls back to the default', () => {
        expect(AudioCommentary.setPrefs({ mood: 'nope' }).mood).toBe('hype');
    });

    test('only languages the device can speak are offered', () => {
        const codes = AudioCommentary.availableLanguages().map(l => l.code);
        expect(codes).toEqual(expect.arrayContaining(['en', 'hi', 'es']));
        expect(codes).not.toContain('ja');   // no Japanese voice in the fixture
    });

    test('novelty voices sort last and never win the auto-pick', () => {
        const names = AudioCommentary.voicesForLanguage('en').map(v => v.name);
        expect(names[names.length - 1]).toBe('Bubbles');
        expect(AudioCommentary.pickVoice().name).toBe('Samantha');
    });

    test('changing language re-picks a voice in that language', () => {
        AudioCommentary.setPrefs({ lang: 'hi' });
        expect(AudioCommentary.pickVoice().name).toBe('Lekha');
        AudioCommentary.setPrefs({ lang: 'es' });
        expect(AudioCommentary.pickVoice().name).toBe('Mónica');
    });

    test('an explicit voice choice wins over the auto-pick', () => {
        AudioCommentary.setPrefs({ voiceURI: 'daniel' });
        expect(AudioCommentary.pickVoice().name).toBe('Daniel');
    });

    test('a voice missing on this device falls back gracefully', () => {
        AudioCommentary.setPrefs({ lang: 'en', voiceURI: 'not-on-this-machine' });
        expect(AudioCommentary.pickVoice().name).toBe('Samantha');
    });

    test('choosing a language clears a voice from the previous one', () => {
        AudioCommentary.setPrefs({ voiceURI: 'daniel' });
        expect(AudioCommentary.setPrefs({ lang: 'hi' }).voiceURI).toBe('');
    });

    test('mood and speed both shape the delivery', () => {
        AudioCommentary.setEnabled(true);

        AudioCommentary.setPrefs({ mood: 'calm', speed: 1 });
        AudioCommentary.speak('line', 'high');
        const calm = speech.spoken[speech.spoken.length - 1];

        AudioCommentary.setPrefs({ mood: 'hype', speed: 1 });
        AudioCommentary.speak('line', 'high');
        const hype = speech.spoken[speech.spoken.length - 1];

        expect(hype.rate).toBeGreaterThan(calm.rate);
        expect(hype.pitch).toBeGreaterThan(calm.pitch);

        AudioCommentary.setPrefs({ mood: 'hype', speed: 1.4 });
        AudioCommentary.speak('line', 'high');
        const fast = speech.spoken[speech.spoken.length - 1];
        expect(fast.rate).toBeGreaterThan(hype.rate);
    });

    test('rate and pitch stay inside the Web Speech legal range', () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ mood: 'hype', speed: 1.4 });
        AudioCommentary.speak('line', 'high');
        const u = speech.spoken[speech.spoken.length - 1];
        expect(u.rate).toBeLessThanOrEqual(2);
        expect(u.rate).toBeGreaterThanOrEqual(0.5);
        expect(u.pitch).toBeLessThanOrEqual(2);
        expect(u.pitch).toBeGreaterThanOrEqual(0.5);
    });

    test('a non-English language needs a key; English never does', () => {
        expect(AudioCommentary.languageNeedsKey('en')).toBe(false);
        expect(AudioCommentary.languageNeedsKey('hi')).toBe(true);
        expect(AudioCommentary.languageReady('en')).toBe(true);
        expect(AudioCommentary.languageReady('hi')).toBe(false);
        GroqService.setKey('gsk_k');
        expect(AudioCommentary.languageReady('hi')).toBe(true);
    });

    test('stays silent rather than speaking English through a Hindi voice', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ lang: 'hi' });
        const m = match([round(met(5, 5), met(8, 8))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(false);
        expect(res.reason).toBe('language-unavailable');
        expect(speech.spoken.length).toBe(0);
    });

    test('speaks in the chosen language when the LLM supplies the words', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ lang: 'hi' });
        GroqService.setKey('gsk_k');
        GroqService._setFetch(jest.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: 'कोरबागैंग ने ब्लाइंड जीत लिया।' } }] }),
        })));
        const m = match([round(met(5, 5), met(8, 8))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(true);
        expect(res.line).toBe('कोरबागैंग ने ब्लाइंड जीत लिया।');
        expect(speech.spoken[0].voice.name).toBe('Lekha');
    });
});
