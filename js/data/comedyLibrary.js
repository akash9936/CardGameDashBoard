/**
 * Comedy Library — the commentator's Hinglish vocabulary, in code.
 *
 * Spec: claude/commentary-style.md §9. Why the phrases live here and not in
 * the prompt:
 *
 *   1. The no-key template path has no prompt at all, and it is what actually
 *      speaks when Groq is slow or absent. Same library serves both paths.
 *   2. Rotation can be *enforced* in code; a prompt instruction is a request.
 *   3. Phrasing is reviewable in a diff.
 *
 * NOT for latency reasons — prefill on Groq is single-digit milliseconds.
 *
 * Register (CLAUDE.md §0): four close friends, so the humour can be sharp.
 * The one rule that survives is craft, not compliance — every phrase here
 * roasts a bid, a blind, or a collapse. None of them roast a person.
 *
 * Each phrase: { id, text, intent, intensity }
 *   intent    — the narrative situation it fits (see INTENTS)
 *   intensity — 1 mild · 2 normal banter · 3 savage
 *
 * Pure module: no DOM, no network, no state. Selection state lives in
 * CommentaryMemory; this file is a constant.
 */
const ComedyLibrary = (() => {

    // Narrative situations. Mapped from a drama `kind` (+ its two-sided
    // context) by intentFor() below — the engine decides the situation, the
    // library only supplies words for it.
    // Two consumers share this vocabulary:
    //   - spoken round commentary (audioCommentary → dramaOf kinds)
    //   - the season facts board (js/data/seasonFacts.js pack)
    // The season pack uses its own intent names, so both sets live here and
    // ALIASES maps the pack's names onto the canonical ones. A fact whose
    // intent has no phrases silently falls back to its baked tail, so a gap
    // here is invisible in the UI — hence the coverage test.
    const INTENTS = [
        'blind_paid_off',      // blind landed
        'blind_backfired',     // blind missed
        'cursed_hand',         // over-extension the cards forced
        'greedy_read',         // over-extension that was a genuine misjudgement
        'one_hand_short',      // near-miss — someone else has the hand
        'bids_collide',        // combined promise > 13
        'quiet_round',         // everyone made it, nobody reached
        'domination',          // leading hard / streak
        'collapse',            // going backwards
        'comeback',            // clawing back
        'match_point',         // one round from winning
        'verdict_win',         // match end, winner
        'verdict_loss',        // match end, loser
        'observation',         // a neutral season statistic — the board's bulk
    ];

    // Season-pack intent → canonical intent.
    const ALIASES = {
        blind_success: 'blind_paid_off',
        blind_failure: 'blind_backfired',
        near_miss: 'one_hand_short',
        overconfidence: 'greedy_read',
        defeat: 'collapse',
        praise: 'domination',
        record: 'domination',
        streak: 'domination',
        lucky_win: 'blind_paid_off',
        king_mode: 'domination',
        match_end: 'verdict_win',
    };

    function canonicalIntent(intent) {
        const key = String(intent || '');
        return ALIASES[key] || key;
    }

    // ── The phrases ─────────────────────────────────────────────────────────
    // Kept deliberately short: these are spoken aloud, and the funny part of a
    // Hinglish line is the last two words. Long set-ups die out loud.
    const PHRASES = [
        // ── blind landed ────────────────────────────────────────────────────
        { id: 'bp01', intent: 'blind_paid_off', intensity: 1, text: 'aankhein band, result solid' },
        { id: 'bp02', intent: 'blind_paid_off', intensity: 2, text: 'bina dekhe hi kaam ho gaya' },
        { id: 'bp03', intent: 'blind_paid_off', intensity: 2, text: 'pagalpan ka reward mil gaya' },
        { id: 'bp04', intent: 'blind_paid_off', intensity: 2, text: 'risk ka jackpot lag gaya' },
        { id: 'bp05', intent: 'blind_paid_off', intensity: 3, text: 'aankh band karke bhi inhi ka din hai' },
        { id: 'bp06', intent: 'blind_paid_off', intensity: 1, text: 'kismat khuli hui thi' },
        { id: 'bp07', intent: 'blind_paid_off', intensity: 2, text: 'dekha bhi nahi, le bhi gaya' },
        { id: 'bp08', intent: 'blind_paid_off', intensity: 3, text: 'ye skill thi ya kismat, koi nahi jaanta' },

        // ── blind missed ────────────────────────────────────────────────────
        { id: 'bb01', intent: 'blind_backfired', intensity: 1, text: 'aankh band ki, kismat bhi band' },
        { id: 'bb02', intent: 'blind_backfired', intensity: 2, text: 'blind ka bhoot utar gaya' },
        { id: 'bb03', intent: 'blind_backfired', intensity: 2, text: 'risk ne dhoka de diya' },
        { id: 'bb04', intent: 'blind_backfired', intensity: 3, text: '140 ka sapna tha, reality check mil gaya' },
        { id: 'bb05', intent: 'blind_backfired', intensity: 2, text: 'gamble fail, seedha minus' },
        { id: 'bb06', intent: 'blind_backfired', intensity: 3, text: 'himmat achhi thi, cards nahi the' },

        // ── over-extension: the cards forced it ─────────────────────────────
        // Never mocking — 7 of 8 real cases were the opponent collapsing.
        { id: 'ch01', intent: 'cursed_hand', intensity: 1, text: 'itne acche patte aana bhi galti hai' },
        { id: 'ch02', intent: 'cursed_hand', intensity: 1, text: 'cards ne chhodne hi nahi diye' },
        { id: 'ch03', intent: 'cursed_hand', intensity: 2, text: 'jeetna hi problem ban gaya' },
        { id: 'ch04', intent: 'cursed_hand', intensity: 2, text: 'is game mein zyada jeetna bhi haar hai' },
        { id: 'ch05', intent: 'cursed_hand', intensity: 1, text: 'inka koi kasoor nahi tha' },

        // ── over-extension: genuinely a misread ─────────────────────────────
        { id: 'gr01', intent: 'greedy_read', intensity: 2, text: 'bid nahi ki thi, loan le liya tha' },
        { id: 'gr02', intent: 'greedy_read', intensity: 2, text: 'confidence zyada tha, cards kam' },
        { id: 'gr03', intent: 'greedy_read', intensity: 2, text: 'khud ki bid mein khud hi phas gaya' },
        { id: 'gr04', intent: 'greedy_read', intensity: 3, text: 'calculation nahi, imagination thi' },
        { id: 'gr05', intent: 'greedy_read', intensity: 3, text: 'lalach buri bala hai' },

        // ── near-miss ───────────────────────────────────────────────────────
        { id: 'oh01', intent: 'one_hand_short', intensity: 1, text: 'bas ek haath' },
        { id: 'oh02', intent: 'one_hand_short', intensity: 1, text: 'almost se points nahi milte' },
        { id: 'oh03', intent: 'one_hand_short', intensity: 2, text: 'itne paas aake reh gaye' },
        { id: 'oh04', intent: 'one_hand_short', intensity: 2, text: 'ek haath ne poora promise kha liya' },
        { id: 'oh05', intent: 'one_hand_short', intensity: 2, text: 'wo ek haath saamne wale ke paas hai' },
        { id: 'oh06', intent: 'one_hand_short', intensity: 3, text: 'chhinn gaya, gira nahi' },

        // ── bids collide ────────────────────────────────────────────────────
        { id: 'bc01', intent: 'bids_collide', intensity: 1, text: 'table pe itne haath hai hi nahi' },
        { id: 'bc02', intent: 'bids_collide', intensity: 2, text: 'dono ka hisaab table se bada hai' },
        { id: 'bc03', intent: 'bids_collide', intensity: 2, text: 'ek toh aaj marega, dekhte hain kaun' },
        { id: 'bc04', intent: 'bids_collide', intensity: 3, text: 'ganit dono ke khilaaf hai' },

        // ── quiet round ─────────────────────────────────────────────────────
        { id: 'qr01', intent: 'quiet_round', intensity: 1, text: 'aaj koi panga nahi liya' },
        { id: 'qr02', intent: 'quiet_round', intensity: 1, text: 'dono ne apna kaam kar liya' },
        { id: 'qr03', intent: 'quiet_round', intensity: 2, text: 'shaanti se nikal gaya round' },
        { id: 'qr04', intent: 'quiet_round', intensity: 2, text: 'koi drama nahi, seedha hisaab' },

        // ── domination ──────────────────────────────────────────────────────
        { id: 'dm01', intent: 'domination', intensity: 1, text: 'aaj inka din hai' },
        { id: 'dm02', intent: 'domination', intensity: 2, text: 'table pe kabza ho gaya' },
        { id: 'dm03', intent: 'domination', intensity: 2, text: 'full form mein hai' },
        { id: 'dm04', intent: 'domination', intensity: 3, text: 'isko rokne ka tender kisne nikala' },
        { id: 'dm05', intent: 'domination', intensity: 2, text: 'ab rokna mushkil hai' },
        { id: 'dm06', intent: 'domination', intensity: 3, text: 'baaki sab bas participate kar rahe hain' },

        // ── collapse ────────────────────────────────────────────────────────
        { id: 'cl01', intent: 'collapse', intensity: 1, text: 'lag gayi' },
        { id: 'cl02', intent: 'collapse', intensity: 2, text: 'nipat gaye' },
        { id: 'cl03', intent: 'collapse', intensity: 2, text: 'band baj gayi' },
        { id: 'cl04', intent: 'collapse', intensity: 2, text: 'scene kharab hai' },
        { id: 'cl05', intent: 'collapse', intensity: 3, text: 'kaam tamaam' },
        { id: 'cl06', intent: 'collapse', intensity: 3, text: 'hawa nikal gayi' },
        { id: 'cl07', intent: 'collapse', intensity: 2, text: 'aaj ka quota poora' },

        // ── comeback ────────────────────────────────────────────────────────
        { id: 'cb01', intent: 'comeback', intensity: 1, text: 'wapas aa gaye' },
        { id: 'cb02', intent: 'comeback', intensity: 2, text: 'scene palat diya' },
        { id: 'cb03', intent: 'comeback', intensity: 2, text: 'dead samjha tha, zinda nikle' },
        { id: 'cb04', intent: 'comeback', intensity: 2, text: 'ab asli game shuru' },
        { id: 'cb05', intent: 'comeback', intensity: 3, text: 'picture abhi baaki thi' },

        // ── match point ─────────────────────────────────────────────────────
        { id: 'mp01', intent: 'match_point', intensity: 1, text: 'darwaza khula hai' },
        { id: 'mp02', intent: 'match_point', intensity: 2, text: 'ek round aur, bas' },
        { id: 'mp03', intent: 'match_point', intensity: 2, text: 'haath badhao aur le lo' },

        // ── verdict: winner ─────────────────────────────────────────────────
        { id: 'vw01', intent: 'verdict_win', intensity: 1, text: 'baazi maar li' },
        { id: 'vw02', intent: 'verdict_win', intensity: 2, text: 'aaj ka king yehi hai' },
        { id: 'vw03', intent: 'verdict_win', intensity: 2, text: 'poora control tha inka' },
        { id: 'vw04', intent: 'verdict_win', intensity: 3, text: 'inhone khela, baaki dekhte reh gaye' },

        // ── verdict: loser ──────────────────────────────────────────────────
        { id: 'vl01', intent: 'verdict_loss', intensity: 1, text: 'aaj inka din nahi tha' },
        { id: 'vl02', intent: 'verdict_loss', intensity: 1, text: 'kal dekhte hain' },
        { id: 'vl03', intent: 'verdict_loss', intensity: 2, text: 'wo ek round kabhi mila hi nahi' },
        { id: 'vl04', intent: 'verdict_loss', intensity: 2, text: 'ladhe toh sahi' },
        { id: 'vl05', intent: 'verdict_loss', intensity: 3, text: 'chapter close' },

        // ── observation ─────────────────────────────────────────────────────
        // Half the season pack is neutral statistics, so this needs the deepest
        // bench: the board wants a distinct tail for every fact it renders.
        { id: 'ob01', intent: 'observation', intensity: 1, text: 'record mein likha hai' },
        { id: 'ob02', intent: 'observation', intensity: 1, text: 'numbers jhooth nahi bolte' },
        { id: 'ob03', intent: 'observation', intensity: 1, text: 'hisaab yehi kehta hai' },
        { id: 'ob04', intent: 'observation', intensity: 1, text: 'aankhon ke saamne hai' },
        { id: 'ob05', intent: 'observation', intensity: 1, text: 'seedhi baat' },
        { id: 'ob06', intent: 'observation', intensity: 2, text: 'ab ye toh maanna padega' },
        { id: 'ob07', intent: 'observation', intensity: 2, text: 'data ne bata diya' },
        { id: 'ob08', intent: 'observation', intensity: 2, text: 'itna toh saaf hai' },
        { id: 'ob09', intent: 'observation', intensity: 2, text: 'season bhar ka nichod' },
        { id: 'ob10', intent: 'observation', intensity: 2, text: 'yehi asli kahani hai' },
        { id: 'ob11', intent: 'observation', intensity: 2, text: 'sab kuch table pe hai' },
        { id: 'ob12', intent: 'observation', intensity: 2, text: 'koi bahana nahi chalega' },
        { id: 'ob13', intent: 'observation', intensity: 3, text: 'ab isme kya bahas karein' },
        { id: 'ob14', intent: 'observation', intensity: 3, text: 'sochne wali baat hai' },
        { id: 'ob15', intent: 'observation', intensity: 3, text: 'khud dekh lo aur samajh lo' },
        // The board renders 14 observation facts and wants a distinct tail for
        // each, so the mild tier has to be deep enough to carry a whole page on
        // its own — a mild reader must not see repeats.
        { id: 'ob16', intent: 'observation', intensity: 1, text: 'season ka hisaab' },
        { id: 'ob17', intent: 'observation', intensity: 1, text: 'aise hi chalta raha' },
        { id: 'ob18', intent: 'observation', intensity: 1, text: 'note kar lo' },
        { id: 'ob19', intent: 'observation', intensity: 1, text: 'yeh bhi ek baat hai' },
        { id: 'ob20', intent: 'observation', intensity: 1, text: 'aankde yaad rakhte hain' },
        { id: 'ob21', intent: 'observation', intensity: 1, text: 'saal bhar ka scene' },
        { id: 'ob22', intent: 'observation', intensity: 1, text: 'ginti bolti hai' },
        { id: 'ob23', intent: 'observation', intensity: 1, text: 'aisa hi hota aaya hai' },
        { id: 'ob24', intent: 'observation', intensity: 1, text: 'is baar ka rikaard' },
        { id: 'ob25', intent: 'observation', intensity: 1, text: 'bas itni si baat' },

        // Mild top-ups so an intensity-1 reader is never starved on the intents
        // the season pack leans on (domination/record/praise all alias here,
        // and overconfidence had no mild phrase at all).
        { id: 'dm07', intent: 'domination', intensity: 1, text: 'lagataar chal raha hai' },
        { id: 'dm08', intent: 'domination', intensity: 1, text: 'inka pallda bhaari hai' },
        { id: 'dm09', intent: 'domination', intensity: 1, text: 'naam bana liya' },
        { id: 'dm10', intent: 'domination', intensity: 1, text: 'sabse aage hain' },
        { id: 'dm11', intent: 'domination', intensity: 1, text: 'kaam bolta hai inka' },
        { id: 'gr06', intent: 'greedy_read', intensity: 1, text: 'thoda zyada soch liya' },
        { id: 'gr07', intent: 'greedy_read', intensity: 1, text: 'andaaza chook gaya' },
        { id: 'gr08', intent: 'greedy_read', intensity: 1, text: 'himmat thi, hisaab nahi' },
        { id: 'gr09', intent: 'greedy_read', intensity: 1, text: 'nazar aage thi, patte peeche' },

        // Mild tier must carry the whole season board on its own: the pack
        // renders several facts per intent and a level-1 reader needs a
        // distinct tail for each (see the coverage test).
        { id: 'bc05', intent: 'bids_collide', intensity: 1, text: 'dono ko jagah nahi milegi' },
        { id: 'bc06', intent: 'bids_collide', intensity: 1, text: 'maang zyada, maal kam' },
        { id: 'bc07', intent: 'bids_collide', intensity: 1, text: 'kuch toh chhodna padega' },
        { id: 'qr05', intent: 'quiet_round', intensity: 1, text: 'sab apni jagah' },
        { id: 'qr06', intent: 'quiet_round', intensity: 1, text: 'seedha saada round' },
        { id: 'bp09', intent: 'blind_paid_off', intensity: 1, text: 'daav chal gaya' },
        { id: 'bp10', intent: 'blind_paid_off', intensity: 1, text: 'bina dekhe bhi ban gaya' },
        { id: 'cl08', intent: 'collapse', intensity: 1, text: 'baat nahi bani' },
        { id: 'cl09', intent: 'collapse', intensity: 1, text: 'peeche reh gaye' },
    ];

    // Sentence shapes. Rotating *form* is what actually creates variety:
    // the same intent said five ways beats five synonyms for the same shape
    // (commentary-style.md §8).
    const FORMS = [
        { id: 'deadpan_report', hint: 'State it flat, like a scoreline. No exclamation.' },
        { id: 'rhetorical_question', hint: 'Ask the table a question you already know the answer to.' },
        { id: 'mock_sympathy', hint: 'Pretend to feel sorry for them.' },
        { id: 'understatement', hint: 'Undersell it heavily — act like it barely happened.' },
        { id: 'direct_address', hint: 'Talk to the table, not about it.' },
    ];

    // ── kind (+ context) → intent ───────────────────────────────────────────
    // The engine already decided what happened; this only picks the drawer.
    // `drama` is a FactsEngine.dramaOf result.
    function intentFor(drama) {
        if (!drama) return null;
        const kind = drama.kind;
        const round = drama.round || {};

        switch (kind) {
            case 'blind-hit': return 'blind_paid_off';
            case 'blind-miss': return 'blind_backfired';
            case 'near-miss': return 'one_hand_short';
            case 'bid-collision': return 'bids_collide';
            case 'lead-change': return 'comeback';
            case 'record-comeback-watch': return 'comeback';
            case 'match-point': return 'match_point';
            case 'big-swing': return 'domination';
            case 'match-end': return 'verdict_win';
            case 'match-start': return null;   // scene-setting needs no phrase
            case 'over-extension': {
                // The distinction that matters: did the opponent collapse (the
                // cards forced it) or did they make their bid (a real misread)?
                const actorIsT1 = drama.actor === drama.teams?.t1;
                const opponent = actorIsT1 ? round.t2 : round.t1;
                return (opponent && Number(opponent.score) < 0) ? 'cursed_hand' : 'greedy_read';
            }
            case 'routine': {
                if (round.bidsCollide) return 'bids_collide';
                const both = round.t1 && round.t2;
                if (both && Number(round.t1.score) > 0 && Number(round.t2.score) > 0) return 'quiet_round';
                return 'collapse';
            }
            default: return null;
        }
    }

    // Candidate phrases for an intent, minus anything already used, capped at
    // `limit`. Never returns the whole library: the prompt gets a handful of
    // options, not a dictionary.
    //
    // opts.usedIds   — phrase ids already spoken this match
    // opts.maxIntensity — 1 mild · 2 normal · 3 savage (default 3)
    // opts.limit     — how many to offer (default 6)
    function candidates(intent, opts = {}) {
        const used = new Set(opts.usedIds || []);
        const maxIntensity = Number.isFinite(opts.maxIntensity) ? opts.maxIntensity : 3;
        const limit = Number.isFinite(opts.limit) ? opts.limit : 6;

        // maxIntensity is a hard ceiling, never traded away. A listener who
        // asked for mild humour must not be served a sharper line just because
        // the mild ones ran out — novelty is worth less than the preference.
        const canonical = canonicalIntent(intent);
        const allowed = PHRASES.filter(p => p.intent === canonical && p.intensity <= maxIntensity);

        const unused = allowed.filter(p => !used.has(p.id));
        if (unused.length) return unused.slice(0, limit);

        // Everything allowed has been used. Reopen the drawer rather than go
        // silent: repetition beats nothing, and anything long enough to exhaust
        // an intent has earned a callback. Callers needing a strict no-repeat
        // guarantee should check `usedIds` against the returned ids.
        return allowed.slice(0, limit);
    }

    function byId(id) {
        return PHRASES.find(p => p.id === id) || null;
    }

    function forms() { return FORMS.slice(); }

    return {
        INTENTS, FORMS, PHRASES,
        intentFor, candidates, byId, forms,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ComedyLibrary;
}
