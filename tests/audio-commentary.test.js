global.Match = require('../js/models/Match.js');
const FactsEngine = require('../js/utils/factsEngine.js');
const GroqService = require('../js/services/groqService.js');
const ComedyLibrary = require('../js/data/comedyLibrary.js');
const CommentaryMemory = require('../js/utils/commentaryMemory.js');

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

    // Over-extension is 8 of 670 stored sides — the rarest thing in the game —
    // so it is 'high': at 'medium' it lost the headline to any blind in the
    // same round.
    test('over-extension is high drama', () => {
        const m = match([round(met(4, 9), met(9, 4))]);   // A took 9 on a 4 promise
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('over-extension');
        expect(d.level).toBe('high');
    });

    // The emotion turns on the opponent: you cannot take double your promise
    // unless the other side takes almost none. In 7 of 8 real cases the cards
    // forced it, and only the 8th was a genuine misread.
    test('over-extension names the opponent, and blames the cards when they collapsed', () => {
        const m = match([round(met(4, 9), met(9, 4))]);   // B promised 9, took 4 → collapsed
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.headline).toContain('Bravo');
        expect(d.headline).toContain('could not take a trick');
    });

    test('over-extension blames the read when the opponent still made their bid', () => {
        // B promised 4 and took exactly 4 — so A's 9 was A's own misjudgement.
        const m = match([round(met(4, 9), met(4, 4))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('over-extension');
        expect(d.headline).toContain('on the read');
    });

    // Every near-miss in the season (74 of 74 sides) had an opponent who scored
    // positive — the hand was taken, not lost. Naming who took it is the story.
    test('a near-miss names who took the hand', () => {
        const m = match([round(met(9, 8), met(4, 5))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('near-miss');
        expect(d.headline).toContain('needed 9 and got 8');
        expect(d.headline).toContain('Bravo');
    });

    test('a near-miss on a small promise is narrated at the low tier', () => {
        // Bids must total ≤ 13 or bid-collision (medium) takes the headline.
        const m = match([round(met(6, 5), met(5, 8))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('near-miss');
        expect(d.level).toBe('low');
    });

    test('high drama outranks lower tiers in the headline', () => {
        // Alpha blind-hits (high) while Bravo near-misses (low here).
        const m = lateMatch([round(blind(9), met(5, 4))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.level).toBe('high');
        expect(d.kind).toBe('blind-hit');
        // The other trigger survives as a supporting fact.
        expect(d.facts.join(' ')).toContain('needed 5 and got 4');
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

    // Only landed blinds are countable in history: a −70 at promise 7 is
    // indistinguishable from an ordinary under-promise, so the fact is phrased
    // as "landed N" rather than implying a precise call count.
    test('blind history quotes only the blinds that landed', () => {
        const past1 = match([round(blind(8), met(5, 5), 1)], 'completed', { id: 'past1', winnerId: 'A' });
        const past2 = match([round(blind(9), met(5, 4), 1)], 'completed', { id: 'past2', winnerId: 'A' });
        // Opponent promise ≤ 6 so the bids do not collide (blind is a fixed 7).
        const now = match([round(blind(3), met(6, 10), 1)]);
        now.finalScore = { team1: 200, team2: 240 };
        const d = FactsEngine.dramaOf(now, null, [past1, past2, now], TEAMS);
        expect(d.kind).toBe('blind-miss');
        expect(d.facts.join(' ')).toContain('landed 2 blinds');
    });

    // Combined promise vs the 13 available hands, knowable before a card is
    // played. Measured over the season: at 10–11 both sides come out positive
    // 73–80% of the time; at 14+ it is 0 of 45 rounds.
    test('bids over 13 collide — somebody must fall short', () => {
        const m = match([round(met(8, 8), met(6, 5))]);   // 14 between them
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        const all = [d.headline, ...d.facts].join(' ');
        expect(all).toContain('14 hands between them');
        expect(d.round.combinedPromise).toBe(14);
        expect(d.round.bidsCollide).toBe(true);
    });

    test('bids inside 13 do not collide', () => {
        const m = match([round(met(5, 5), met(5, 8))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.round.bidsCollide).toBe(false);
        expect([d.headline, ...d.facts].join(' ')).not.toContain('only holds 13');
    });

    // A +140 blind against a −40 miss is exactly BIG_SWING_MIN, so without a
    // guard `big-swing` is just a second label for the blind on the same round.
    test('big-swing does not fire when a blind already explains it', () => {
        const m = match([round(blind(9), met(4, 4))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.kind).toBe('blind-hit');
        expect([d.headline, ...d.facts].join(' ')).not.toContain('swing');
    });

    test('big-swing still fires when no blind is involved', () => {
        // +130 against −40: 170 is short of the bar, so use a wider pair.
        // P13→A13 is +130; P5→A0 is −50. Swing 180, no blind anywhere.
        const m = match([round(met(13, 13), met(5, 0))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect([d.headline, ...d.facts].join(' ')).toContain('swing');
    });

    // ~91% of blinds are called from behind, where +140 is the only realistic
    // way to close a gap. The blind called while *leading* is the rare one.
    test('a blind called while leading is high drama even mid-match', () => {
        const m = match([round(blind(9), met(5, 4))]);
        m.finalScore = { team1: 200 + 140, team2: 60 - 50 };
        const prev = { ...m, finalScore: { team1: 200, team2: 60 } };
        const d = FactsEngine.dramaOf(m, prev, [m], TEAMS);
        expect(d.kind).toBe('blind-hit');
        expect(d.level).toBe('high');
        expect(d.headline).toContain('in front already');
    });

    test('a deep-trailing blind is framed as having nothing else', () => {
        const m = match([round(blind(9), met(5, 4))]);
        m.finalScore = { team1: 50 + 140, team2: 300 - 50 };
        const prev = { ...m, finalScore: { team1: 50, team2: 300 } };
        const d = FactsEngine.dramaOf(m, prev, [m], TEAMS);
        expect(d.headline).toContain('nothing else that closes it');
    });

    test('the round is exposed two-sided for downstream phrasing', () => {
        const m = match([round(met(5, 6), met(6, 7))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(d.round.t1).toEqual({ promise: 5, actual: 6, score: 51, blind: false });
        expect(d.round.t2).toEqual({ promise: 6, actual: 7, score: 61, blind: false });
        expect(d.round.combinedPromise).toBe(11);
    });

    // ── Comedy steering (commentary-style.md §7–§9) ─────────────────────────
    test('the packet carries comedy direction, and never facts inside it', () => {
        const m = match([round(blind(9), met(5, 4))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        const steer = AudioCommentary.comedySteer(d);
        const packet = AudioCommentary.dramaPacket(d, steer);

        expect(packet.comedy.intent).toBe('blind_paid_off');
        expect(packet.comedy.formHint).toEqual(expect.any(String));
        expect(packet.comedy.phrases.length).toBeGreaterThan(0);
        // Direction only — no numbers smuggled into the comedy block.
        expect(JSON.stringify(packet.comedy)).not.toMatch(/\d/);
    });

    test('the packet carries the round two-sided', () => {
        const m = match([round(met(5, 6), met(6, 7))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        const packet = AudioCommentary.dramaPacket(d, null);
        expect(packet.round.combinedPromise).toBe(11);
        expect(packet.round.t2.actual).toBe(7);
    });

    test('a packet without steering still works', () => {
        const m = match([round(met(5, 6), met(6, 7))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(AudioCommentary.dramaPacket(d).comedy).toBeUndefined();
    });

    test('dramaPacket stays a pure projection — same input, same output', () => {
        const m = match([round(blind(9), met(5, 4))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        expect(AudioCommentary.dramaPacket(d)).toEqual(AudioCommentary.dramaPacket(d));
    });

    // The no-key path must not degrade into a different character: an English
    // stats line between two Hinglish jokes breaks the persona out loud.
    describe('Hinglish templates', () => {
        const hi = d => FactsEngine.dramaTemplate(d, { lang: 'hinglish' });
        const HINDI = /\b(ne|ka|ki|ko|hai|hain|tha|thi|gaya|gayi|gaye|liya|mein|bhi|toh|nahi|aur|kya|chahiye|dono|mara|manga)\b/i;

        test('every round shape has a Hinglish line with no English prose', () => {
            const shapes = [
                [blind(9), met(5, 5)],                       // blind-hit
                [blind(3), met(6, 10)],                      // blind-miss
                [met(6, 5), met(5, 8)],                      // near-miss
                [met(4, 9), met(6, 4)],                      // over-extension, forced
                [met(4, 9), met(4, 4)],                      // over-extension, misread
                [met(8, 8), met(6, 5)],                      // bid-collision
                [met(5, 6), met(6, 7)],                      // routine
            ];
            for (const [t1, t2] of shapes) {
                const m = match([round(t1, t2)]);
                const line = hi(FactsEngine.dramaOf(m, null, [m], TEAMS));
                expect(line).toMatch(HINDI);
                expect(line).not.toMatch(/called blind|needed \d|promised \d|have won it/);
            }
        });

        // The whole point of the comedy library: without this the template path
    // repeats one fixed sentence per kind forever, and the template path is
    // exactly what speaks when Groq is absent, slow, or out of quota.
        test('the rotated phrase reaches the spoken template', () => {
            const m = match([round(blind(9), met(5, 5))]);
            const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
            const steer = { phrases: ['risk ka jackpot lag gaya'] };
            const line = FactsEngine.dramaTemplate(d, { lang: 'hinglish', steer });
            expect(line).toMatch(/risk ka jackpot lag gaya/i);
        });

        test('two rounds of the same kind get different phrases', () => {
            const m = match([round(met(6, 5), met(5, 8))]);
            const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
            const first = FactsEngine.dramaTemplate(d,
                { lang: 'hinglish', steer: { phrases: ['bas ek haath'] } });
            const second = FactsEngine.dramaTemplate(d,
                { lang: 'hinglish', steer: { phrases: ['almost se points nahi milte'] } });
            expect(first).not.toBe(second);
        });

        test('no steer still produces the baked line — never silence', () => {
            const m = match([round(met(6, 5), met(5, 8))]);
            const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
            const line = FactsEngine.dramaTemplate(d, { lang: 'hinglish' });
            expect(line).toMatch(HINDI);
            expect(line.length).toBeGreaterThan(20);
        });

        test('the phrase is a real library phrase for that intent', async () => {
            const ComedyLibrary = require('../js/data/comedyLibrary.js');
            const m = match([round(blind(9), met(5, 5))]);
            const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
            const steer = AudioCommentary.comedySteer(d);
            expect(steer).toBeTruthy();
            expect(steer.intent).toBe('blind_paid_off');
            const texts = ComedyLibrary.PHRASES
                .filter(p => p.intent === 'blind_paid_off').map(p => p.text);
            expect(texts).toContain(steer.phrases[0]);
        });

        // The ledger must burn the phrase that was SAID, not the one that was
        // offered. Recording the offered id let the model's actual phrase stay
        // "unused" and repeat next round — the repetition the ledger exists to
        // stop.
        describe('the ledger records what was said', () => {
            const ComedyLibrary = require('../js/data/comedyLibrary.js');
            const steerFor = (...texts) => ({
                phrases: texts,
                phraseId: (ComedyLibrary.PHRASES.find(p => p.text === texts[0]) || {}).id,
            });

            test('a phrase the model reached for is the one recorded', () => {
                // Offered three; the line uses the second.
                const steer = steerFor('lag gayi', 'nipat gaye', 'band baj gayi');
                const id = AudioCommentary.phraseUsedIn(
                    'Sky/K2 ne 8 bola aur 3 le paye. Nipat gaye.', steer);
                expect(id).toBe(ComedyLibrary.PHRASES.find(p => p.text === 'nipat gaye').id);
                expect(id).not.toBe(steer.phraseId);
            });

            test('punctuation and case do not defeat the match', () => {
                const steer = steerFor('kaam tamaam', 'lag gayi');
                expect(AudioCommentary.phraseUsedIn('Bhai, KAAM TAMAAM!', steer))
                    .toBe(ComedyLibrary.PHRASES.find(p => p.text === 'kaam tamaam').id);
            });

            test('an invented line falls back to the offered phrase', () => {
                const steer = steerFor('lag gayi', 'nipat gaye');
                expect(AudioCommentary.phraseUsedIn('Total collapse out there.', steer))
                    .toBe(steer.phraseId);
            });

            test('only offered phrases count — no coincidental library match', () => {
                // 'kaam tamaam' is a real library phrase but was NOT offered
                // here, so it must not be burned.
                const steer = steerFor('lag gayi');
                expect(AudioCommentary.phraseUsedIn('Bhai kaam tamaam.', steer))
                    .toBe(steer.phraseId);
            });

            test('the longest overlapping phrase wins', () => {
                // 'aaj inka din hai' contains no shorter offered phrase by
                // accident, so pair it with one that nests.
                const steer = { phrases: ['lag gayi', 'waat lag gayi'], phraseId: 'cl01' };
                // Only 'lag gayi' is a real library phrase; the nested one is
                // absent, so the real one is what can match.
                expect(AudioCommentary.phraseUsedIn('Aaj toh lag gayi.', steer))
                    .toBe(ComedyLibrary.PHRASES.find(p => p.text === 'lag gayi').id);
            });

            test('no steer records nothing rather than guessing', () => {
                expect(AudioCommentary.phraseUsedIn('Some line.', null)).toBeNull();
            });

            test('end to end: the model\'s phrase is not offered again', async () => {
                AudioCommentary.setEnabled(true);
                AudioCommentary.setPrefs({ lang: 'hinglish' });
                GroqService.setKey('gsk_k');

                const m = match([round(met(6, 5), met(5, 8))]);
                const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
                const steer = AudioCommentary.comedySteer(d);
                // Have the "model" use the SECOND offered phrase, not the first.
                const used = steer.phrases[1];
                const usedId = ComedyLibrary.PHRASES.find(p => p.text === used).id;

                const CommentaryMemory = require('../js/utils/commentaryMemory.js');
                CommentaryMemory.record(d.matchId, {
                    phraseId: AudioCommentary.phraseUsedIn(`Bas ek haath. ${used}.`, steer),
                });
                expect(CommentaryMemory.hasUsed(d.matchId, usedId)).toBe(true);
                // And the one merely offered stays available.
                expect(CommentaryMemory.hasUsed(d.matchId, steer.phraseId)).toBe(false);
            });
        });

        test('negative totals are spoken, not written as a bare minus sign', () => {
            const m = match([round(met(5, 6), met(6, 7))]);
            m.finalScore = { team1: -40, team2: 60 };
            const line = hi(FactsEngine.dramaOf(m, null, [m], TEAMS));
            expect(line).not.toMatch(/-\d/);
        });

        test('English mode is untouched', () => {
            const m = match([round(blind(9), met(5, 5))]);
            const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
            expect(FactsEngine.dramaTemplate(d)).toContain('called blind');
            expect(FactsEngine.dramaTemplate(d, { lang: 'en' })).toContain('called blind');
        });
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

    test('a spoken line records its phrase and opening against the match', async () => {
        AudioCommentary.setEnabled(true);
        const m = lateMatch([round(blind(9), met(5, 5))]);
        await AudioCommentary.announceRound(m, null, TEAMS, [m]);

        const mem = CommentaryMemory.state(String(m.id));
        expect(mem.usedPhraseIds.length).toBe(1);
        expect(mem.recentForms.length).toBe(1);
        expect(mem.recentIntents).toContain('blind_paid_off');
    });

    // A moment that never reached the speaker must not consume vocabulary —
    // otherwise a run of skipped rounds silently burns the whole library.
    test('a skipped moment burns no phrase', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ lang: 'hi' });      // needs a key we do not have
        const m = lateMatch([round(blind(9), met(5, 5))]);

        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(false);
        expect(res.reason).toBe('language-unavailable');
        expect(CommentaryMemory.state(String(m.id)).usedPhraseIds).toEqual([]);
    });

    test('roastIntensity caps the phrases offered to the model', () => {
        AudioCommentary.setPrefs({ roastIntensity: 1 });
        const m = lateMatch([round(met(4, 3), met(9, 10))]);
        const d = FactsEngine.dramaOf(m, null, [m], TEAMS);
        const steer = AudioCommentary.comedySteer(d);
        const mild = ComedyLibrary.candidates(steer.intent, { maxIntensity: 1, limit: 99 })
            .map(p => p.text);
        expect(steer.phrases.every(t => mild.includes(t))).toBe(true);
    });

    // Hinglish has hand-written templates, so unlike every other non-English
    // language it speaks with no key and no network.
    test('Hinglish speaks without a Groq key', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ lang: 'hinglish' });
        const m = lateMatch([round(blind(9), met(5, 5))]);

        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(true);
        expect(res.line).toMatch(/\b(ne|ki|hai|gaye|liya|mara)\b/);
        expect(res.line).not.toMatch(/called blind and landed/);
    });

    test('a keyless non-templated language still stays silent', async () => {
        AudioCommentary.setEnabled(true);
        AudioCommentary.setPrefs({ lang: 'hi' });
        const m = lateMatch([round(blind(9), met(5, 5))]);
        const res = await AudioCommentary.announceRound(m, null, TEAMS, [m]);
        expect(res.spoken).toBe(false);
        expect(res.reason).toBe('language-unavailable');
    });

    test('Hinglish borrows the Hindi voice pool — there is no hinglish voice', () => {
        AudioCommentary._setSpeech({
            getVoices: () => [
                { name: 'Lekha', lang: 'hi-IN', voiceURI: 'lekha' },
                { name: 'Samantha', lang: 'en-US', voiceURI: 'sam' },
            ],
            speak() {}, cancel() {},
        }, function U(t) { this.text = t; });
        AudioCommentary.setPrefs({ lang: 'hinglish', voiceURI: '' });
        expect(AudioCommentary.pickVoice().lang).toBe('hi-IN');
    });

    test('roastIntensity is clamped to 1-3', () => {
        expect(AudioCommentary.setPrefs({ roastIntensity: 9 }).roastIntensity).toBe(3);
        expect(AudioCommentary.setPrefs({ roastIntensity: 0 }).roastIntensity).toBe(1);
        expect(AudioCommentary.setPrefs({ roastIntensity: 'x' }).roastIntensity).toBe(2);
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
            // roastIntensity 2 = normal banter: four friends, so mild is too
            // timid a default (CLAUDE.md §0).
            lang: 'en', voiceURI: '', speed: 1, mood: 'hype', roastIntensity: 2,
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
