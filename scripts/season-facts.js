#!/usr/bin/env node
/**
 * Season Facts generator — turns the whole match archive into a static pack of
 * records and fun facts that the Stats page can render instantly.
 *
 * Why static? The live ticker (FactsEngine.funFacts) recomputes a handful of
 * nuggets on every Stats render, and the pundit lines need a BYO Groq key in
 * the browser. Season-wide facts are different: they change only when new
 * matches are played, they are expensive to phrase well, and every visitor
 * should see them — key or no key. So we compute them once, here, and commit
 * the result as data.
 *
 * Pipeline:
 *   1. Load teams + matches (newest db-dump backup, or --live from Firestore)
 *   2. SeasonDigest.build()  → deterministic grouped aggregates
 *   3. Groq                  → phrases each aggregate as one punchy line
 *   4. Write js/data/seasonFacts.js (a plain window global, no build step)
 *
 * The LLM is a wordsmith only: it receives the digest and must reuse its
 * numbers verbatim. Every generated line is verified against the digest before
 * it is written (see verifyLine) — anything containing a number the digest
 * does not contain is dropped and the deterministic fallback is kept instead.
 * That keeps the same contract as the live commentary: the model never
 * computes, and a hallucinated record never reaches the page.
 *
 * Usage:
 *   node scripts/season-facts.js                  # newest dump  → static pack
 *   node scripts/season-facts.js --live           # pull Firestore first
 *   node scripts/season-facts.js --dry-run        # print, don't write
 *   node scripts/season-facts.js --no-llm         # deterministic lines only
 *
 * Needs GROQ_API_KEY in the environment or .env (skips the LLM without one).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_FILE = path.join(ROOT, 'js', 'data', 'seasonFacts.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 20000;

// The shared free-tier key lives in .env (gitignored), NOT in this file — a
// key committed to a public repo is a key anyone can spend, and GitHub's
// secret scanning will reject the push anyway.
//
// Put it in .env as GROQ_API_KEY, or let the script prompt you for one when it
// needs it (see promptForKey). With no key at all the pack still generates,
// just with plainly-worded facts.
const DEFAULT_GROQ_KEY = null;

// ─── .env loading (same shape as dump-db.js) ─────────────────────────────────
function loadEnv() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

// ─── Data loading ────────────────────────────────────────────────────────────
// Prefers the newest db-dump/backup-* directory, falling back to the flat
// db-dump/*.json pair that predates the timestamped backups.
function newestDumpDir() {
    const dumpRoot = path.join(ROOT, 'db-dump');
    if (!fs.existsSync(dumpRoot)) return null;
    const backups = fs.readdirSync(dumpRoot)
        .filter(d => d.startsWith('backup-'))
        .filter(d => {
            const p = path.join(dumpRoot, d);
            return fs.statSync(p).isDirectory()
                && fs.existsSync(path.join(p, 'teams.json'))
                && fs.existsSync(path.join(p, 'matches.json'));
        })
        .sort();                       // timestamped names sort chronologically
    if (backups.length) return path.join(dumpRoot, backups[backups.length - 1]);
    if (fs.existsSync(path.join(dumpRoot, 'teams.json'))) return dumpRoot;
    return null;
}

function loadFromDump() {
    const dir = newestDumpDir();
    if (!dir) throw new Error('No db-dump found. Run: node scripts/dump-db.js');
    const teams = JSON.parse(fs.readFileSync(path.join(dir, 'teams.json'), 'utf8'));
    const matches = JSON.parse(fs.readFileSync(path.join(dir, 'matches.json'), 'utf8'));
    return {
        teams: Array.isArray(teams) ? teams : Object.values(teams),
        matches: Array.isArray(matches) ? matches : Object.values(matches),
        source: path.relative(ROOT, dir),
    };
}

async function loadFromFirestore() {
    const { initializeApp } = require('firebase/app');
    const { getFirestore, collection, getDocs } = require('firebase/firestore');
    const apiKey = process.env.FIREBASE_API_KEY;
    if (!apiKey || apiKey === 'your_firebase_api_key_here') {
        throw new Error('FIREBASE_API_KEY missing in .env — cannot use --live');
    }
    const app = initializeApp({
        apiKey,
        authDomain: 'card-game-dashboard.firebaseapp.com',
        projectId: 'card-game-dashboard',
        storageBucket: 'card-game-dashboard.firebasestorage.app',
        messagingSenderId: '165351945339',
        appId: '1:165351945339:web:b1725b0d9272d67369dede',
    });
    const db = getFirestore(app);
    const grab = async name => {
        const snap = await getDocs(collection(db, name));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    };
    return { teams: await grab('teams'), matches: await grab('matches'), source: 'firestore (live)' };
}

// ─── Fact slots ──────────────────────────────────────────────────────────────
// Each slot is one card on the page. `fallback` is the deterministic sentence
// we ship if the LLM is unavailable or its line fails verification; `data` is
// the slice of the digest the model is allowed to phrase from.
//
// Slots whose data is missing (a young season with no comebacks yet) are
// simply skipped — the page renders whatever it has.
function buildSlots(digest) {
    const slots = [];
    // `intent` routes the fact to a ComedyLibrary pool (claude/commentary-style.md
    // §9) — it says what KIND of joke the fact wants, never what the joke is.
    const add = (id, icon, label, data, fallback, intent = 'quiet_round') => {
        if (data == null || fallback == null) return;
        slots.push({ id, icon, label, data, fallback, intent });
    };

    const o = digest.overview;
    const r = digest.records;
    const b = digest.blinds;

    // Optional clause helpers — a fact should carry its when and its context,
    // but never invent one when the underlying data is missing.
    const on = d => (d ? ` (${d})` : '');
    // Scores can be negative under §4.1/§4.3, so "544–-219" is a real risk.
    // An en-dash separator plus a "minus" word keeps it readable and speakable.
    const score = (w, l) => {
        if (!Number.isFinite(w) || !Number.isFinite(l)) return '';
        return `${w} to ${l < 0 ? `minus ${Math.abs(l)}` : l}`;
    };
    // "A vs B" → the side that is not `winner`.
    const otherSide = (matchup, winner) => {
        const parts = String(matchup).split(' vs ');
        if (parts.length !== 2) return matchup;
        return parts[0] === winner ? parts[1] : parts[0];
    };

    add('season-scale', '🃏', 'The season so far', o,
        `${o.matchesCompleted} matches, ${o.rounds} rounds and ${o.handsDealt.toLocaleString('en-US')} hands dealt across ${o.teams} teams — ` +
        `${o.blindsCalled} of those promises were called blind, and ${o.negativeRatePct}% of all round-sides ended negative.`, 'quiet_round');

    if (r.longestMatch) {
        const lm = r.longestMatch;
        add('longest-match', '⏳', 'Longest match', lm,
            `${lm.match} went ${lm.rounds} rounds${on(lm.date)} before anyone reached 500, finishing ${score(lm.winningScore, lm.losingScore)} — ` +
            `the league average is ${lm.avgRounds} rounds.`, 'bids_collide');
    }
    if (r.shortestMatch) {
        const sm = r.shortestMatch;
        add('shortest-match', '⚡', 'Fastest finish', sm,
            `${sm.match} was over in ${sm.rounds} rounds${on(sm.date)}, ${score(sm.winningScore, sm.losingScore)} — ` +
            `against a league average of ${sm.avgRounds}.`, 'match_point');
    }
    if (r.closestFinish) {
        const cf = r.closestFinish;
        add('closest-finish', '😮‍💨', 'Closest finish', cf,
            `${cf.match} came down to ${cf.margin} point${cf.margin === 1 ? '' : 's'}${on(cf.date)} — ` +
            `${score(cf.winningScore, cf.losingScore)} after ${cf.rounds} rounds.`, 'one_hand_short');
    }
    if (r.biggestBlowout) {
        const bb = r.biggestBlowout;
        add('biggest-blowout', '🪓', 'Biggest hiding', bb,
            `${bb.winner} put ${bb.margin} points between themselves and ${otherSide(bb.match, bb.winner)}${on(bb.date)}, ` +
            `finishing ${score(bb.winningScore, bb.losingScore)} over ${bb.rounds} rounds.`, 'collapse');
    }
    if (r.biggestComeback) {
        const bc = r.biggestComeback;
        add('biggest-comeback', '🔄', 'Biggest comeback', bc,
            `${bc.team} trailed ${bc.opponent} by ${bc.deficit} points${on(bc.date)} and still won it ${score(bc.finalScore, bc.opponentScore)} in ${bc.rounds} rounds.`, 'comeback');
    }
    if (r.highestFinalScore) {
        const hf = r.highestFinalScore;
        add('record-total', '🏔️', 'Record total', hf,
            `${hf.team} closed a match on ${hf.score} points${on(hf.date)} — ${hf.opponentScore} for the opposition, and all of it in just ${hf.rounds} rounds.`, 'domination');
    }
    if (r.bestSingleRound) {
        const br = r.bestSingleRound;
        add('best-round', '🚀', 'Best single round', br,
            `${br.team} banked ${br.score} in round ${br.round} against ${br.vs}${br.blind ? ' — called blind, and it landed' : ''}${on(br.date)}; ` +
            `${br.vs} took ${br.opponentScore} in the same round.`, 'blind_paid_off');
    }
    if (r.worstSingleRound) {
        const wr = r.worstSingleRound;
        add('worst-round', '💀', 'Worst single round', wr,
            `${wr.team} promised ${wr.promise}, took ${wr.actual}, and paid ${wr.score} for it in round ${wr.round} against ${wr.vs}${on(wr.date)}` +
            `${wr.wonTheMatch ? ' — and still went on to win the match' : ''}.`, 'greedy_read');
    }
    if (r.biggestRoundSwing) {
        const bs = r.biggestRoundSwing;
        add('biggest-swing', '⚡', 'Biggest single-round swing', bs,
            `A single round swung ${bs.swing} points${on(bs.date)}: ${bs.team} scored ${bs.score} in round ${bs.round} while ${bs.vs} came away with ${bs.opponentScore}.`, 'domination');
    }

    if (b && b.called > 0) {
        add('blind-economy', '🕶️', 'The blind economy', b,
            `${b.called} blind calls have been made; ${b.landed} landed (${b.hitPct}%), for a net ${b.netPoints >= 0 ? '+' : ''}${b.netPoints.toLocaleString('en-US')} points across the league.`, 'blind_paid_off');
        const ace = b.byTeam[0];
        if (ace) {
            add('blind-ace', '🎯', 'Blind specialists', ace,
                `${ace.team} are the coldest blind callers going — ${ace.landed} of ${ace.called} landed (${ace.hitPct}%), worth ${ace.netPoints >= 0 ? '+' : ''}${ace.netPoints.toLocaleString('en-US')} points.`, 'blind_paid_off');
        }
        const worstBlind = b.byTeam[b.byTeam.length - 1];
        if (worstBlind && b.byTeam.length >= 3 && worstBlind.hitPct < ace.hitPct) {
            add('blind-liability', '🙈', 'Blind liability', worstBlind,
                `${worstBlind.team} keep reaching for the blind and keep missing — ${worstBlind.landed} of ${worstBlind.called} landed (${worstBlind.hitPct}%).`, 'blind_backfired');
        }
    }

    // The promise-band table is the most interesting group-by in the digest:
    // it shows which promises actually pay. Hand the model the extremes.
    const bands = (digest.promiseBands || []).filter(x => x.called >= 20);
    if (bands.length >= 2) {
        const best = bands.slice().sort((a, b2) => b2.avgPoints - a.avgPoints)[0];
        const worst = bands.slice().sort((a, b2) => a.avgPoints - b2.avgPoints)[0];
        add('promise-economics', '📈', 'What a promise is worth', { best, worst, bands },
            `A promise of ${best.promise} is the sweet spot at ${best.avgPoints} points a round; a promise of ${worst.promise} averages ${worst.avgPoints}.`, 'greedy_read');
    }

    const rival = (digest.rivalries || [])[0];
    if (rival) {
        add('top-rivalry', '⚔️', 'The great rivalry', rival,
            `${rival.pair} have met ${rival.meetings} times — it stands ${rival.record}.`, 'bids_collide');
    }
    const lopsided = (digest.rivalries || []).filter(x => x.meetings >= 3 && x.dominance >= 70)[0];
    if (lopsided) {
        add('one-sided-rivalry', '💪', 'Nemesis', lopsided,
            `${lopsided.record} — the most one-sided rivalry in the league.`, 'domination');
    }

    const s = digest.streaks;
    if (s.longestWinStreak) {
        add('win-streak', '🔥', 'Longest win streak', s.longestWinStreak,
            `${s.longestWinStreak.team} once won ${s.longestWinStreak.count} matches in a row.`, 'domination');
    }
    if (s.longestPromiseStreak) {
        add('promise-streak', '🤝', 'Longest promise streak', s.longestPromiseStreak,
            `${s.longestPromiseStreak.team} kept ${s.longestPromiseStreak.count} promises in a row without a single negative round.`, 'domination');
    }

    // Team personalities — the two most distinctive profiles in the league.
    const profiles = (digest.teams || []).filter(t => t.rounds >= 30);
    if (profiles.length) {
        const boldest = profiles.slice().sort((a, b2) => b2.avgPromise - a.avgPromise)[0];
        add('boldest-team', '🎲', 'Boldest bidders', boldest,
            `${boldest.team} promise ${boldest.avgPromise} hands a round on average — the boldest bidders with 30+ rounds played.`, 'greedy_read');
        const safest = profiles.slice().sort((a, b2) => b2.promisesKeptPct - a.promisesKeptPct)[0];
        add('most-reliable', '🛡️', 'Most reliable', safest,
            `${safest.team} keep ${safest.promisesKeptPct}% of their promises — the most dependable side in the league.`, 'verdict_win');
    }

    let oddIndex = 0;
    for (const odd of (digest.oddities || [])) {
        // Oddities are league-wide trivia with no single emotional shape, so
        // they rotate across fitting intents — this keeps any one phrase pool
        // from being drained by the eight of them.
        const ODD_INTENTS = ['quiet_round', 'bids_collide', 'cursed_hand',
                             'greedy_read', 'one_hand_short', 'collapse'];
        add(`odd-${odd.id}`, '🔍', 'Did you know', odd, odd.stat,
            ODD_INTENTS[oddIndex++ % ODD_INTENTS.length]);
    }

    return slots;
}

// ─── Groq ────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [
    'You are the statistician for an office card-game league, writing the',
    '"Season Records" board that hangs on the wall.',
    'Game in one breath: each round both teams promise 4-13 hands (or call',
    'BLIND for a fixed 7). Missing the promise or taking double it scores',
    'minus promise x10; meeting it scores promise x10 plus 1 per extra hand;',
    'a blind is +140 if it lands, -70 if it fails. First team to 500 wins.',
    'You will receive a JSON array of fact slots. Each has an id, a label, a',
    'data object of PRE-COMPUTED numbers, and a plain fallback sentence.',
    'Rewrite each fallback into ONE punchy sentence with more personality —',
    'dry wit, the tone of a sports almanac that enjoys itself.',
    'HARD RULES:',
    '- Use ONLY numbers and names that appear in that slot\'s data object.',
    '- Never invent, derive, round, or recompute a number. No arithmetic.',
    '- If a number is not in the data, do not mention it.',
    '- Keep every line under 25 words. No markdown, no emoji, no quotes.',
    '- Team names are real colleagues: tease the cards, never the person.',
    'Return STRICT JSON: {"facts":[{"id":"<same id>","text":"<your line>"}]}',
    'Include every id you were given, exactly once.',
].join(' ');

// The free tier caps tokens-per-DAY (100k on llama-3.3-70b) as well as per
// minute, and `max_tokens` is charged against the budget as *requested*, not
// as used. So we send a few slots at a time with a tight max_tokens: small
// batches keep working right down to the last few hundred tokens of quota,
// where one big request would be refused outright.
const BATCH_SIZE = 4;
const BATCH_PAUSE_MS = 2000;
const MAX_TOKENS_PER_BATCH = 60 * BATCH_SIZE;   // ~60 tokens buys one sentence

// A 429 can mean "wait a moment" (per-minute) or "come back tomorrow"
// (per-day). Only the second is worth interrupting the user for, so we read
// which one it was out of the error body.
function isDailyLimit(bodyText) {
    return /per day|TPD|RPD/i.test(String(bodyText || ''));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One batch → { ok, lines, status }. `status` is 'ok' | 'rate-limited' |
// 'unauthorized' | 'error', so the caller can tell an exhausted key apart from
// a transient hiccup and prompt the user accordingly.
async function callGroqBatch(slots, apiKey) {
    const payload = slots.map(s => ({
        id: s.id, label: s.label, data: s.data, fallback: s.fallback,
    }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                temperature: 0.8,
                max_tokens: MAX_TOKENS_PER_BATCH,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: JSON.stringify(payload) },
                ],
            }),
            signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
            return { ok: false, status: 'unauthorized', lines: {} };
        }
        if (res.status === 429) {
            // Groq tells us how long to wait; honour it once, then retry.
            // A daily cap is not worth waiting out, so surface it separately.
            const retryAfter = Number(res.headers.get('retry-after')) || 0;
            const body = await res.text().catch(() => '');
            return {
                ok: false,
                status: isDailyLimit(body) ? 'quota-exhausted' : 'rate-limited',
                retryAfter,
                reason: 'the free-tier daily token budget is spent',
                lines: {},
            };
        }
        if (!res.ok) {
            return { ok: false, status: 'error', reason: `${res.status} ${res.statusText}`, lines: {} };
        }

        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        if (typeof raw !== 'string') return { ok: false, status: 'error', reason: 'empty response', lines: {} };
        const parsed = JSON.parse(raw);
        const lines = {};
        for (const f of (parsed.facts || [])) {
            if (f && typeof f.id === 'string' && typeof f.text === 'string') {
                lines[f.id] = f.text.trim().replace(/^["'\s]+|["'\s]+$/g, '');
            }
        }
        return { ok: true, status: 'ok', lines };
    } catch (e) {
        return { ok: false, status: 'error', reason: e.message, lines: {} };
    } finally {
        clearTimeout(timer);
    }
}

// Phrase every slot, a batch at a time. Resolves { lines, exhausted } —
// `exhausted` is true when the key ran out of quota or was rejected, which is
// the signal main() uses to offer the user a new key.
async function callGroq(slots, apiKey) {
    const lines = {};
    let exhausted = false, reason = null;

    for (let i = 0; i < slots.length; i += BATCH_SIZE) {
        const batch = slots.slice(i, i + BATCH_SIZE);
        const n = Math.floor(i / BATCH_SIZE) + 1;
        const total = Math.ceil(slots.length / BATCH_SIZE);

        let res = await callGroqBatch(batch, apiKey);

        // A per-minute limit is worth waiting out once; a daily cap is not.
        if (res.status === 'rate-limited') {
            const wait = Math.min((res.retryAfter || 8) * 1000, 30000);
            console.log(`  batch ${n}/${total}: rate limited, waiting ${Math.round(wait / 1000)}s…`);
            await sleep(wait);
            res = await callGroqBatch(batch, apiKey);
        }

        if (res.status === 'unauthorized') {
            exhausted = true;
            reason = 'the key was rejected (401/403)';
            break;
        }
        if (res.status === 'quota-exhausted') {
            exhausted = true;
            reason = res.reason;
            break;
        }
        if (res.status === 'rate-limited') {
            exhausted = true;
            reason = 'the key is still rate limited after waiting';
            break;
        }
        if (!res.ok) {
            console.warn(`  batch ${n}/${total} failed (${res.reason}) — those slots keep their fallback.`);
            continue;
        }

        Object.assign(lines, res.lines);
        console.log(`  batch ${n}/${total}: ${Object.keys(res.lines).length} lines`);
        if (i + BATCH_SIZE < slots.length) await sleep(BATCH_PAUSE_MS);
    }

    return { lines, exhausted, reason };
}

// ─── Verification — the model may phrase, never invent ───────────────────────
// Every number in a generated line must appear somewhere in that slot's data.
// This is the guard that lets us commit LLM prose as if it were data: a
// hallucinated record is rejected here and the deterministic line ships
// instead. Comparison is on digits alone, so "1,264" matches 1264 and "73%"
// matches 73.
function numbersIn(text) {
    return (String(text).match(/-?\d[\d,]*\.?\d*/g) || [])
        .map(n => n.replace(/,/g, ''))
        .map(n => String(Number(n)))
        .filter(n => n !== 'NaN');
}

function verifyLine(line, slot) {
    if (!line) return { ok: false, reason: 'empty' };
    if (line.length > 200) return { ok: false, reason: 'too long' };

    // Allowed numbers: everything in the slot's data, plus the numbers the
    // fallback already uses, plus the rule constants the model may quote.
    const allowed = new Set([
        ...numbersIn(JSON.stringify(slot.data)),
        ...numbersIn(slot.fallback),
        '4', '7', '13', '10', '140', '70', '500', '2',   // locked-rule constants
    ]);
    for (const n of numbersIn(line)) {
        if (!allowed.has(n)) return { ok: false, reason: `invented number ${n}` };
    }
    return { ok: true };
}

// ─── Key exhaustion prompt ───────────────────────────────────────────────────
// The shared key is free-tier and runs dry. Rather than silently degrading to
// deterministic lines, tell the user what happened and let them decide: paste
// their own key, or cancel and ship the deterministic pack (which is complete
// and correct — the AI only changes the wording).
//
// Non-interactive runs (CI, piped stdin) skip the prompt and just carry on.
function promptForKey(reason) {
    return new Promise(resolve => {
        if (!process.stdin.isTTY) {
            console.log('  Non-interactive run — continuing with deterministic lines.');
            return resolve(null);
        }

        console.log('');
        console.log('  ────────────────────────────────────────────────────────────');
        console.log('   ⚠️  The shared Groq key is used up.');
        console.log('  ────────────────────────────────────────────────────────────');
        console.log(`  Reason: ${reason}.`);
        console.log('');
        console.log('  The facts themselves are already computed and correct — a key');
        console.log('  only makes the wording wittier. You can:');
        console.log('');
        console.log('    • Paste your own Groq key (free at https://console.groq.com/keys)');
        console.log('    • Press Enter to cancel and keep the plain wording');
        console.log('');

        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('  Groq key (or Enter to cancel): ', answer => {
            rl.close();
            const key = String(answer || '').trim();
            if (!key) {
                console.log('  Cancelled — shipping deterministic lines.\n');
                return resolve(null);
            }
            if (!key.startsWith('gsk_')) {
                console.log('  That does not look like a Groq key (they start with "gsk_").');
                console.log('  Cancelled — shipping deterministic lines.\n');
                return resolve(null);
            }
            console.log('');
            resolve(key);
        });
    });
}

// Offer to persist a working key to .env so the next run picks it up without
// asking again. .env is gitignored, so the key stays local — never committed.
function offerToSaveKey(key) {
    return new Promise(resolve => {
        if (!process.stdin.isTTY) return resolve(false);

        const envPath = path.join(ROOT, '.env');
        if (fs.existsSync(envPath) && /^\s*GROQ_API_KEY=/m.test(fs.readFileSync(envPath, 'utf8'))) {
            return resolve(false);   // already set — nothing to offer
        }

        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('  Save this key to .env so you are not asked again? [y/N] ', answer => {
            rl.close();
            if (!/^y(es)?$/i.test(String(answer || '').trim())) {
                console.log('  Not saved.\n');
                return resolve(false);
            }
            try {
                const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
                const sep = (existing && !existing.endsWith('\n')) ? '\n' : '';
                fs.appendFileSync(envPath, `${sep}\n# Groq key for scripts/season-facts.js\nGROQ_API_KEY=${key}\n`);
                console.log('  Saved to .env (gitignored — it will not be committed).\n');
                resolve(true);
            } catch (e) {
                console.warn(`  Could not write .env (${e.message}).\n`);
                resolve(false);
            }
        });
    });
}

// ─── Output ──────────────────────────────────────────────────────────────────
function renderFile(pack) {
    return `/**
 * Season Facts — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  npm run season-facts
 * Source: scripts/season-facts.js  +  js/utils/seasonDigest.js
 *
 * Every number here was computed deterministically from the match archive;
 * the prose was phrased by Groq and verified number-by-number against that
 * archive before being written. See scripts/season-facts.js § verifyLine.
 */
const SeasonFacts = ${JSON.stringify(pack, null, 4)};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeasonFacts;
}
`;
}

// Deterministic RNG (mulberry32) — the same archive must produce the same
// pack, so phrase selection cannot use Math.random. Re-running the generator
// on unchanged data should be a no-op in git.
function seededRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
    loadEnv();
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const noLlm = args.includes('--no-llm');
    const live = args.includes('--live');

    // --roast=1|2|3 — how sharp the Hinglish tails are allowed to be.
    // 1 friendly · 2 normal office banter (default) · 3 savage.
    const roastArg = args.find(a => a.startsWith('--roast'));
    const roastIntensity = roastArg
        ? Math.min(3, Math.max(1, Number(roastArg.split('=')[1]) || 2))
        : 2;

    const { teams, matches, source } = live ? await loadFromFirestore() : loadFromDump();
    console.log(`Source: ${source} — ${teams.length} teams, ${matches.length} matches`);

    const SeasonDigest = require(path.join(ROOT, 'js', 'utils', 'seasonDigest.js'));
    const digest = SeasonDigest.build(teams, matches);
    console.log(`Digest: ${digest.overview.matchesCompleted} completed matches, ` +
                `${digest.overview.rounds} rounds, ${digest.overview.blindsCalled} blinds`);

    const slots = buildSlots(digest);
    console.log(`Slots:  ${slots.length} facts to phrase`);

    // The key comes from the environment / .env. DEFAULT_GROQ_KEY is null by
    // design — see the note at its declaration.
    const ownKey = process.env.GROQ_API_KEY;
    let apiKey = ownKey || DEFAULT_GROQ_KEY;
    let generated = {};

    if (noLlm) {
        console.log('LLM:    skipped (--no-llm)');
    } else if (!apiKey) {
        // No key configured: offer to take one now rather than silently
        // shipping unphrased facts.
        console.log('LLM:    no GROQ_API_KEY set.');
        const newKey = await promptForKey('no key is configured');
        if (newKey) {
            apiKey = newKey;
            console.log(`LLM:    asking Groq (${GROQ_MODEL})…`);
            const res = await callGroq(slots, apiKey);
            generated = res.lines;
            if (!res.exhausted) await offerToSaveKey(newKey);
        }
    } else {
        console.log(`LLM:    asking Groq (${GROQ_MODEL})…`);
        let res = await callGroq(slots, apiKey);
        generated = res.lines;

        // Shared key ran dry → offer the user their own, then retry only the
        // slots we never got a line for.
        if (res.exhausted) {
            const newKey = await promptForKey(res.reason);
            if (newKey) {
                const remaining = slots.filter(s => !generated[s.id]);
                console.log(`LLM:    retrying ${remaining.length} facts with your key…`);
                const retry = await callGroq(remaining, newKey);
                Object.assign(generated, retry.lines);
                if (retry.exhausted) {
                    console.warn(`  That key also failed: ${retry.reason}.`);
                } else {
                    apiKey = newKey;
                    await offerToSaveKey(newKey);
                }
            }
        }
    }

    // The Hinglish tail is applied AFTER verification, never before — the
    // verifier checks numbers, and a comedy phrase must never be able to
    // launder one past it. One ledger for the whole pack means no phrase
    // repeats across the 28 facts (claude/commentary-style.md §8).
    // The phrase library is shared with the live spoken commentary. If it is
    // not present (a checkout that predates it), the pack still generates —
    // the facts are the product, the Hinglish tail is the garnish.
    let ComedyLibrary = null;
    try {
        ComedyLibrary = require(path.join(ROOT, 'js', 'data', 'comedyLibrary.js'));
    } catch (e) {
        console.warn('  comedyLibrary.js not found — facts will ship without Hinglish tails.');
    }
    const usedIds = [];                    // the ledger — no phrase twice per pack
    const rng = seededRng(slots.length);   // reproducible packs

    // candidates() returns the unused, intensity-capped pool for an intent,
    // best-first. Picking from it with a seeded RNG keeps packs reproducible
    // while still varying which phrase each fact gets.
    const pickPhrase = intent => {
        if (!ComedyLibrary) return null;
        const pool = ComedyLibrary.candidates(intent, {
            usedIds, maxIntensity: roastIntensity, limit: 99,
        });
        if (!pool.length) return null;
        const chosen = pool[Math.floor(rng() * pool.length)] || pool[0];
        usedIds.push(chosen.id);
        return chosen;
    };

    let used = 0, rejected = 0;
    const facts = slots.map(slot => {
        const candidate = generated[slot.id];
        let text = slot.fallback;
        let ai = false;
        if (candidate) {
            const v = verifyLine(candidate, slot);
            if (v.ok) { text = candidate; ai = true; used++; }
            else { rejected++; console.warn(`  ✗ ${slot.id}: ${v.reason} — using fallback`); }
        }
        const phrase = pickPhrase(slot.intent);
        return {
            id: slot.id, icon: slot.icon, label: slot.label,
            text,
            tail: phrase ? phrase.text : null,
            intent: slot.intent,
            ai,
        };
    });

    console.log(`Result: ${used} AI-phrased, ${rejected} rejected, ` +
                `${facts.length - used} deterministic`);
    console.log(`Comedy: ${new Set(usedIds).size} distinct Hinglish tails at intensity ${roastIntensity}`);

    const pack = {
        generatedAt: new Date().toISOString(),
        source,
        model: (used > 0) ? GROQ_MODEL : null,
        roastIntensity,
        coverage: {
            matches: digest.overview.matchesCompleted,
            rounds: digest.overview.rounds,
            teams: digest.overview.teams,
        },
        facts,
        digest,          // shipped too: the Stats page can render live tables from it
    };

    if (dryRun) {
        for (const f of facts) {
            console.log(`  ${f.icon} [${f.ai ? 'AI ' : 'det'}] ${f.text}${f.tail ? ' ' + f.tail : ''}`);
        }
        console.log('\n--dry-run: nothing written.');
        return;
    }

    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, renderFile(pack));
    console.log(`Wrote:  ${path.relative(ROOT, OUT_FILE)} (${facts.length} facts)`);
}

// Exported for tests; running the file directly still generates the pack.
module.exports = { buildSlots, verifyLine, numbersIn, isDailyLimit, DEFAULT_GROQ_KEY };

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
