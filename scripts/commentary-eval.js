#!/usr/bin/env node
/**
 * Commentary Eval — replay real history through the real prompt and score it.
 *
 * Spec: ai-continuity.md §4. claude/commentary-style.md §11 defines an
 * evaluation rubric and nothing runs it, so every prompt decision in this repo
 * has been made by reading a handful of outputs. With 661 rounds of real play
 * sitting in db-dump, that is a choice rather than a constraint.
 *
 * This answers questions like:
 *   - does temperature 0.9 actually beat 0.7?
 *   - does a change reduce repetition, or just move it?
 *   - do the continuity nuggets (memory/session/players) improve lines?
 *
 * OFFLINE ONLY. This never runs in the browser and never in CI — it needs a
 * key and a network, and the Jest gate must stay key-free and offline.
 *
 * Pipeline:
 *   1. Load teams + matches (newest db-dump backup)
 *   2. Sample N moments, STRATIFIED by drama tier (see sampleMoments)
 *   3. Build the real packet via FactsEngine.factsPacket
 *   4. Generate a line per variant through the real Groq path
 *   5. Score: deterministic checks always; LLM judge unless --no-judge
 *   6. Write a JSON + Markdown report
 *
 * Usage:
 *   node scripts/commentary-eval.js                     # default sample
 *   node scripts/commentary-eval.js --n 40              # sample size
 *   node scripts/commentary-eval.js --variants a,b      # A/B two configs
 *   node scripts/commentary-eval.js --no-judge          # generate only
 *   node scripts/commentary-eval.js --seed 42           # reproducible sample
 *   node scripts/commentary-eval.js --human             # unlabelled A/B sheet
 *   node scripts/commentary-eval.js --out <dir>         # report destination
 *
 * Needs GROQ_API_KEY in the environment or .env.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// factsPacket pulls in leagueMemory / sessionArc / playerStats itself, so the
// packets generated here are byte-identical to the ones the browser builds.
const FactsEngine = require('../js/utils/factsEngine.js');
const GroqService = require('../js/services/groqService.js');

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const JUDGE_TIMEOUT_MS = 20000;

// Groq's free tier is ~30 req/min. Pace so a long run does not spend half its
// time being rate-limited.
const PAUSE_MS = 2200;

// ─── .env loading (same shape as season-facts.js / dump-db.js) ───────────────
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
        .sort();
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

// ─── Seeded RNG ──────────────────────────────────────────────────────────────
// Sampling must be reproducible: two variants have to see the IDENTICAL moment
// set, or an A/B compares samples rather than prompts. mulberry32 is the same
// small deterministic generator the win-probability tests use.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(list, rng) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// ─── Moment enumeration ──────────────────────────────────────────────────────
/**
 * Replay a match round by round, producing one candidate moment per round
 * plus a match-start and (for completed matches) a match-end.
 *
 * Each moment carries a PARTIAL match — the match as it stood at that point —
 * so the packet sees exactly what the live app would have seen. Replaying with
 * the finished match would leak the result into round 2's commentary.
 */
function momentsOf(match, teams, matches) {
    const rounds = Array.isArray(match.rounds) ? match.rounds : [];
    if (!rounds.length) return [];

    const out = [];
    const partialOf = (n) => {
        const slice = rounds.slice(0, n);
        let s1 = 0, s2 = 0;
        for (const r of slice) {
            s1 += Number(r.team1?.score || 0);
            s2 += Number(r.team2?.score || 0);
        }
        return Object.assign({}, match, {
            rounds: slice,
            finalScore: { team1: s1, team2: s2 },
            // Mid-replay the match was still running, whatever it is now.
            status: n >= rounds.length ? match.status : 'in_progress',
            winnerId: n >= rounds.length ? match.winnerId : null,
            currentRound: n,
        });
    };

    out.push({
        matchId: String(match.id),
        moment: 'match-start',
        stratum: 'match-start',
        roundIndex: 0,
        match: partialOf(0),
    });

    for (let n = 1; n <= rounds.length; n++) {
        const partial = partialOf(n);
        const prev = n > 1 ? partialOf(n - 1) : null;
        let drama = null;
        try { drama = FactsEngine.dramaOf(partial, prev, matches, teams); }
        catch (e) { drama = null; }

        // dramaOf returns `kind` (what happened) and `level` (how big) — NOT
        // `moment`/`tier`. The packet field the prompt switches on is `moment`,
        // and it is set from `kind`. commentary-style.md §12 documents this
        // naming split; reading the wrong pair silently collapses every
        // stratum to "low", which is exactly the bug this comment prevents.
        const isEnd = n === rounds.length && match.status === 'completed';
        const level = (drama && drama.level) || 'low';
        out.push({
            matchId: String(match.id),
            moment: isEnd ? 'match-end' : (drama && drama.kind) || 'routine',
            stratum: isEnd ? 'match-end' : (level === 'finale' ? 'high' : level),
            roundIndex: n,
            drama,
            match: partial,
        });
    }
    return out;
}

/**
 * Stratified sample (ai-continuity.md §4.3).
 *
 * A uniform sample of 661 rounds is ~80% ordinary rounds, and ordinary rounds
 * are exactly where commentary quality matters least. Shares are deliberate:
 * match-start/end carry the two-sentence contract, `low` is where repetition
 * shows up worst.
 */
const STRATA = [
    { key: 'match-start', share: 0.15 },
    { key: 'match-end', share: 0.15 },
    { key: 'high', share: 0.25 },
    { key: 'medium', share: 0.20 },
    { key: 'low', share: 0.25 },
];

function sampleMoments(all, n, rng) {
    const byStratum = new Map(STRATA.map(s => [s.key, []]));
    for (const m of all) {
        if (byStratum.has(m.stratum)) byStratum.get(m.stratum).push(m);
    }

    const picked = [];
    const shortfalls = [];
    for (const s of STRATA) {
        const want = Math.max(1, Math.round(n * s.share));
        const pool = shuffled(byStratum.get(s.key) || [], rng);
        const take = pool.slice(0, want);
        picked.push(...take);
        if (take.length < want) {
            shortfalls.push(`${s.key}: wanted ${want}, had ${take.length}`);
        }
    }
    // No silent caps: say what the archive could not supply.
    if (shortfalls.length) {
        console.log(`  note: stratum shortfall — ${shortfalls.join('; ')}`);
    }
    return shuffled(picked, rng).slice(0, n);
}

// ─── Variants ────────────────────────────────────────────────────────────────
/**
 * A variant is a named generation config. Add to this map to test an idea;
 * `--variants a,b` selects which run.
 *
 * `continuity: false` strips the ai-continuity.md fields from the packet,
 * which makes "did league memory actually help?" directly measurable.
 */
const VARIANTS = {
    a: { label: 'current (temp 0.9, continuity on)', temperature: 0.9, continuity: true },
    b: { label: 'cooler (temp 0.7, continuity on)', temperature: 0.7, continuity: true },
    c: { label: 'no continuity (temp 0.9)', temperature: 0.9, continuity: false },
};

// ─── Generation ──────────────────────────────────────────────────────────────
function packetFor(moment, teams, matches, variant) {
    const packet = FactsEngine.factsPacket(moment.match, teams, matches, {
        continuity: variant.continuity !== false,
    });
    packet.moment = moment.moment;
    return packet;
}

async function generate(packet, variant, apiKey, spoken = true) {
    const systemPrompt = spoken ? GroqService.SPOKEN_PROMPT : GroqService.SYSTEM_PROMPT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                temperature: variant.temperature,
                max_tokens: 120,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: JSON.stringify(packet) },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) return { line: null, error: `HTTP ${res.status}` };
        const data = await res.json();
        const line = data?.choices?.[0]?.message?.content;
        if (typeof line !== 'string') return { line: null, error: 'no content' };
        return { line: line.trim().replace(/^["'\s]+|["'\s]+$/g, '') };
    } catch (e) {
        return { line: null, error: String(e && e.name === 'AbortError' ? 'timeout' : e) };
    } finally {
        clearTimeout(timer);
    }
}

// ─── Deterministic checks ────────────────────────────────────────────────────
// Factual grounding is NEVER left to the judge. A judge that opines on
// hallucination is a worse detector than a regex, and this repo already
// committed to that approach in season-facts.js § verifyLine.
function numbersIn(text) {
    return (String(text).match(/-?\d[\d,]*\.?\d*/g) || [])
        .map(n => n.replace(/,/g, ''))
        .map(n => String(Number(n)))
        .filter(n => n !== 'NaN');
}

const RULE_CONSTANTS = ['0', '1', '2', '4', '7', '10', '13', '70', '140', '500'];

function checkFactual(line, packet) {
    const allowed = new Set([...numbersIn(JSON.stringify(packet)), ...RULE_CONSTANTS]);
    const bad = numbersIn(line).filter(n => !allowed.has(n));
    return { ok: bad.length === 0, invented: bad };
}

function sentenceCount(line) {
    return (String(line).match(/[.!?।॥。！？]+/g) || []).length || 1;
}

function checkLength(line, moment) {
    const twoBeat = moment === 'match-start' || moment === 'match-end';
    const maxSentences = twoBeat ? 2 : 1;
    const maxChars = twoBeat ? 320 : 190;
    const s = sentenceCount(line);
    return {
        ok: s <= maxSentences && line.length <= maxChars,
        sentences: s, chars: line.length, maxSentences, maxChars,
    };
}

/** First two words, lowercased — the most audible repetition tic out loud. */
function openingOf(line) {
    return String(line).toLowerCase().replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

/** Repetition across a whole variant run: repeated openings + n-gram overlap. */
function repetitionReport(lines) {
    const openings = new Map();
    for (const l of lines) {
        if (!l) continue;
        const o = openingOf(l);
        if (!o) continue;
        openings.set(o, (openings.get(o) || 0) + 1);
    }
    const repeated = Array.from(openings.entries())
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1]);

    // Trigram overlap: how much vocabulary is recycled across lines.
    const grams = new Map();
    let total = 0;
    for (const l of lines) {
        if (!l) continue;
        const words = String(l).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        for (let i = 0; i + 2 < words.length; i++) {
            const g = words.slice(i, i + 3).join(' ');
            grams.set(g, (grams.get(g) || 0) + 1);
            total++;
        }
    }
    const repeatedGrams = Array.from(grams.values()).filter(n => n > 1).length;
    return {
        repeatedOpenings: repeated.reduce((s, [, n]) => s + n - 1, 0),
        topOpenings: repeated.slice(0, 5).map(([o, n]) => `"${o}" x${n}`),
        distinctTrigrams: grams.size,
        recycledTrigrams: repeatedGrams,
        trigramRecycleRate: total ? repeatedGrams / grams.size : 0,
    };
}

// ─── The judge ───────────────────────────────────────────────────────────────
// Used COMPARATIVELY (A vs B on an identical seeded sample), never as an
// absolute quality headline — an LLM scoring "is this funny" is a weak signal
// on its own but a much steadier one when ranking two runs of the same moments.
const JUDGE_PROMPT = [
    'You are judging one line of spoken commentary for an office card-game',
    'league played by four close friends. The humour is meant to be sharp and',
    'affectionate — teasing a bid, a blind, or a collapse. Corporate blandness',
    'is a failure, not a virtue.',
    'You will receive the FACTS packet the writer was given and the LINE they',
    'wrote. Score the line 1-5 on each dimension:',
    '- funny: does it actually land a joke, or merely report the score?',
    '- inVoice: does it sound like a live commentator over a table of friends?',
    '- speakable: does it read aloud cleanly (no markdown, no stumbles)?',
    '- usesFacts: does it build on the specific numbers/history it was given?',
    'Do NOT check arithmetic — that is verified separately.',
    'Reply with ONLY a JSON object:',
    '{"funny":n,"inVoice":n,"speakable":n,"usesFacts":n,"note":"<8 words"}',
].join(' ');

async function judge(line, packet, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                temperature: 0,
                max_tokens: 120,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: JUDGE_PROMPT },
                    {
                        role: 'user',
                        content: `FACTS:\n${JSON.stringify(packet)}\n\nLINE:\n${line}`,
                    },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        if (typeof raw !== 'string') return null;
        const parsed = JSON.parse(raw);
        const num = v => (typeof v === 'number' && v >= 1 && v <= 5) ? v : null;
        return {
            funny: num(parsed.funny),
            inVoice: num(parsed.inVoice),
            speakable: num(parsed.speakable),
            usesFacts: num(parsed.usesFacts),
            note: typeof parsed.note === 'string' ? parsed.note.slice(0, 60) : '',
        };
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function mean(values) {
    const nums = values.filter(v => typeof v === 'number');
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(v, digits = 2) {
    return v == null ? '—' : Number(v).toFixed(digits);
}

// ─── Report ──────────────────────────────────────────────────────────────────
function renderMarkdown(report) {
    const L = [];
    L.push('# Commentary Eval');
    L.push('');
    L.push(`- source: \`${report.source}\``);
    L.push(`- moments: ${report.n} (seed ${report.seed})`);
    L.push(`- judged: ${report.judged ? 'yes' : 'no'}`);
    L.push('');
    L.push('## Results');
    L.push('');
    const heads = report.variants.map(v => v.key);
    L.push(`| metric | ${heads.join(' | ')} |`);
    L.push(`|---|${heads.map(() => '---').join('|')}|`);

    const row = (label, pick) =>
        L.push(`| ${label} | ${report.variants.map(v => pick(v)).join(' | ')} |`);

    row('generated', v => `${v.generated}/${report.n}`);
    row('factual ✓', v => `${v.factualOk}/${v.generated}`);
    row('length ✓', v => `${v.lengthOk}/${v.generated}`);
    row('repeated openings', v => String(v.repetition.repeatedOpenings));
    row('trigram recycle', v => fmt(v.repetition.trigramRecycleRate));
    if (report.judged) {
        row('funny', v => fmt(mean(v.scores.funny)));
        row('in-voice', v => fmt(mean(v.scores.inVoice)));
        row('speakable', v => fmt(mean(v.scores.speakable)));
        row('uses facts', v => fmt(mean(v.scores.usesFacts)));
    }
    L.push('');

    for (const v of report.variants) {
        L.push(`### ${v.key} — ${v.label}`);
        L.push('');
        // No silent caps: if generation failed, say so and why, rather than
        // letting a rate-limited run read as "0 findings".
        if (v.errors && v.errors.length) {
            const tally = {};
            for (const e of v.errors) tally[e] = (tally[e] || 0) + 1;
            const summary = Object.entries(tally)
                .sort((a, b) => b[1] - a[1])
                .map(([e, n]) => `${e} x${n}`).join(', ');
            L.push(`**${v.errors.length} generation failure(s):** ${summary}`);
            L.push('');
        }
        if (v.repetition.topOpenings.length) {
            L.push(`Repeated openings: ${v.repetition.topOpenings.join(', ')}`);
            L.push('');
        }
        if (v.invented.length) {
            L.push(`**Invented numbers (${v.invented.length}):**`);
            for (const i of v.invented.slice(0, 10)) {
                L.push(`- \`${i.numbers.join(', ')}\` — ${i.line}`);
            }
            L.push('');
        }
        L.push('<details><summary>Sample lines</summary>');
        L.push('');
        for (const s of v.samples.slice(0, 15)) {
            L.push(`- **${s.moment}** — ${s.line}`);
        }
        L.push('');
        L.push('</details>');
        L.push('');
    }
    return L.join('\n');
}

/** Unlabelled A/B sheet — the only ground truth that matters is four humans. */
function renderHumanSheet(report) {
    const L = ['# Blind A/B sheet', '', 'Score each line 1-5. Variants are unlabelled on purpose.', ''];
    const first = report.variants[0];
    for (let i = 0; i < first.samples.length; i++) {
        const m = first.samples[i];
        L.push(`## ${i + 1}. ${m.moment}`);
        // Rotate which variant prints first so position carries no signal.
        const order = report.variants.map((v, vi) => ({ v, vi }));
        if (i % 2 === 1) order.reverse();
        for (const { v } of order) {
            const s = v.samples[i];
            L.push(`- [ ] ${s && s.line ? s.line : '(no line)'}`);
        }
        L.push('');
    }
    return L.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const args = { n: 30, seed: 7, judge: true, variants: ['a', 'b'], human: false, out: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--n') args.n = Math.max(1, parseInt(argv[++i], 10) || 30);
        else if (a === '--seed') args.seed = parseInt(argv[++i], 10) || 7;
        else if (a === '--no-judge') args.judge = false;
        else if (a === '--human') args.human = true;
        else if (a === '--out') args.out = argv[++i];
        else if (a === '--variants') args.variants = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    }
    return args;
}

async function main() {
    loadEnv();
    const args = parseArgs(process.argv.slice(2));

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.error('No GROQ_API_KEY in environment or .env — nothing to evaluate.');
        console.error('This harness generates real lines; it cannot run offline.');
        process.exit(1);
    }

    for (const key of args.variants) {
        if (!VARIANTS[key]) {
            console.error(`Unknown variant "${key}". Known: ${Object.keys(VARIANTS).join(', ')}`);
            process.exit(1);
        }
    }

    const { teams, matches, source } = loadFromDump();
    console.log(`Loaded ${matches.length} matches, ${teams.length} teams from ${source}`);

    // Enumerate every candidate moment across the archive, then stratify.
    const all = [];
    for (const m of matches) {
        if (m.status === 'cancelled') continue;
        all.push(...momentsOf(m, teams, matches));
    }
    const counts = {};
    for (const m of all) counts[m.stratum] = (counts[m.stratum] || 0) + 1;
    console.log(`Enumerated ${all.length} moments: ${JSON.stringify(counts)}`);

    const rng = mulberry32(args.seed);
    const sample = sampleMoments(all, args.n, rng);
    console.log(`Sampled ${sample.length} moments (seed ${args.seed})`);
    console.log('');

    const variants = [];
    for (const key of args.variants) {
        const cfg = VARIANTS[key];
        console.log(`Variant ${key}: ${cfg.label}`);
        const samples = [];
        const invented = [];
        const errors = [];
        const scores = { funny: [], inVoice: [], speakable: [], usesFacts: [] };
        let generated = 0, factualOk = 0, lengthOk = 0;

        for (let i = 0; i < sample.length; i++) {
            const moment = sample[i];
            const packet = packetFor(moment, teams, matches, cfg);
            const { line, error } = await generate(packet, cfg, apiKey);
            if (!line) {
                samples.push({ moment: moment.moment, line: null, error });
                errors.push(error || 'unknown');
                process.stdout.write('x');
                // A daily-token exhaustion will not recover inside this run, so
                // stop rather than burning minutes printing x's. The free tier
                // is ~100k tokens/day and a judged 30-moment A/B spends a good
                // fraction of it — this is a routine outcome, not a crash.
                if (String(error).includes('HTTP 429') && errors.length >= 3
                    && errors.slice(-3).every(e => String(e).includes('HTTP 429'))) {
                    console.log('\n  Groq rate limit hit three times in a row —');
                    console.log('  likely the daily token budget. Stopping this variant.');
                    break;
                }
                await sleep(PAUSE_MS);
                continue;
            }
            generated++;

            const fact = checkFactual(line, packet);
            if (fact.ok) factualOk++;
            else invented.push({ line, numbers: fact.invented });

            const len = checkLength(line, moment.moment);
            if (len.ok) lengthOk++;

            let verdict = null;
            if (args.judge) {
                await sleep(PAUSE_MS);
                verdict = await judge(line, packet, apiKey);
                if (verdict) {
                    for (const k of Object.keys(scores)) {
                        if (typeof verdict[k] === 'number') scores[k].push(verdict[k]);
                    }
                }
            }

            samples.push({
                moment: moment.moment, matchId: moment.matchId,
                line, factual: fact.ok, length: len, verdict,
            });
            process.stdout.write(fact.ok ? '.' : '!');
            await sleep(PAUSE_MS);
        }
        console.log('');

        variants.push({
            key, label: cfg.label, generated, factualOk, lengthOk,
            invented, scores, samples, errors,
            repetition: repetitionReport(samples.map(s => s.line)),
        });
    }

    const report = {
        source, n: sample.length, seed: args.seed, judged: args.judge,
        model: GROQ_MODEL, variants,
    };

    const outDir = args.out || path.join(ROOT, 'scratch', 'commentary-eval');
    fs.mkdirSync(outDir, { recursive: true });
    // The run's own start time is fine here — this is a report filename, not
    // anything the pure modules depend on.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const jsonPath = path.join(outDir, `${stamp}.json`);
    const mdPath = path.join(outDir, `${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, renderMarkdown(report));
    if (args.human) {
        const humanPath = path.join(outDir, `${stamp}-blind.md`);
        fs.writeFileSync(humanPath, renderHumanSheet(report));
        console.log(`Blind sheet: ${path.relative(ROOT, humanPath)}`);
    }

    console.log('');
    console.log(renderMarkdown(report).split('\n## Results')[1].split('###')[0].trim());
    console.log('');
    console.log(`Report: ${path.relative(ROOT, mdPath)}`);
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    momentsOf, sampleMoments, checkFactual, checkLength, repetitionReport,
    numbersIn, openingOf, mulberry32, STRATA, VARIANTS,
};
