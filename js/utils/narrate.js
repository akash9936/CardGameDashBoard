/**
 * Narrator + Pressure derivation for the broadcast layer.
 * Pure functions only — no DOM, no Firestore. Safe to call on every render.
 *
 * See claude/ui-stats-improvements.md §3b for the design intent.
 */
const Narrate = (() => {
    // ─── Pressure meter (§3b.2) ──────────────────────────────────────────────
    // Returns one of: 'calm' | 'building' | 'critical' | 'match-point'.
    // The whole UI subtly shifts based on this single derived state.
    function pressureState(match) {
        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);
        const high = Math.max(s1, s2);

        // Both teams within 50 of the win line is also match-point territory.
        const bothNear = (500 - s1 <= 50) && (500 - s2 <= 50);
        if (high >= 450 || bothNear) return 'match-point';
        if (high >= 400) return 'critical';
        if (high >= 300) return 'building';
        return 'calm';
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────
    function lastRound(match) {
        const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
        return rounds.length ? rounds[rounds.length - 1] : null;
    }

    function isBlind(side) {
        if (!side) return false;
        if (side.blind === true) return true;
        if (side.blind === false) return false;
        // Legacy data: infer from the locked blind shape.
        return side.promise === 7 && (side.score === 140 || side.score === -70);
    }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : 'Team';
    }

    function recentAvg(match, side, n = 3) {
        const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
        const tail = rounds.slice(-n);
        if (!tail.length) return 0;
        const sum = tail.reduce((acc, r) => acc + Number(r?.[side]?.score || 0), 0);
        return Math.round(sum / tail.length);
    }

    // ─── Narrator (§3b.1) ────────────────────────────────────────────────────
    // Produces three short sentences answering: what / why / next.
    // Hand-written templates per outcome — robotic narration is the failure
    // mode, so keep wording specific and varied.
    function narrate(match, teams) {
        if (!match || match.status === 'pending') {
            return {
                what: 'Match not started yet.',
                why:  'Both teams are waiting at 0.',
                next: 'Start the match to begin round 1.',
            };
        }

        if (match.status === 'cancelled') {
            return {
                what: 'This match was cancelled.',
                why:  'No further rounds will be played.',
                next: 'Start a fresh match between the same teams when ready.',
            };
        }

        const t1Name = teamName(teams, match.team1Id);
        const t2Name = teamName(teams, match.team2Id);
        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);
        const lead = s1 - s2;                       // positive = team1 ahead
        const leader = lead === 0 ? null : (lead > 0 ? 'team1' : 'team2');
        const leaderName = leader === 'team1' ? t1Name : (leader === 'team2' ? t2Name : null);
        const trailerName = leader === 'team1' ? t2Name : (leader === 'team2' ? t1Name : null);
        const absLead = Math.abs(lead);

        // If the match is over, narrate the result, not the last round.
        if (match.status === 'completed') {
            const winnerName = String(match.winnerId) === String(match.team1Id) ? t1Name
                            : String(match.winnerId) === String(match.team2Id) ? t2Name
                            : null;
            const winS = winnerName === t1Name ? s1 : s2;
            const lossS = winnerName === t1Name ? s2 : s1;
            return {
                what: winnerName
                    ? `${winnerName} won ${winS}–${lossS}.`
                    : `Match ended ${s1}–${s2}.`,
                why:  `Crossed the 500-point line in ${match.rounds?.length || 0} rounds.`,
                next: 'Open the match for the full round-by-round breakdown.',
            };
        }

        const r = lastRound(match);
        if (!r) {
            return {
                what: `${t1Name} vs ${t2Name} — round 1 about to begin.`,
                why:  'Both teams sit at 0. First to 500 wins.',
                next: 'Promises run 4–13, or call blind for a fixed 7.',
            };
        }

        // ── WHAT — the most consequential side of the last round ─────────────
        const sides = ['team1', 'team2'].map(side => ({
            side,
            name: side === 'team1' ? t1Name : t2Name,
            promise: Number(r[side]?.promise || 0),
            actual: Number(r[side]?.actual || 0),
            score: Number(r[side]?.score || 0),
            blind: isBlind(r[side]),
        }));
        // The side whose round was most dramatic (largest |score|) drives the headline.
        sides.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
        const headline = sides[0];

        let what;
        if (headline.blind && headline.score > 0) {
            what = `${headline.name} called blind and hit it (+140).`;
        } else if (headline.blind && headline.score < 0) {
            what = `${headline.name} called blind and missed it (−70).`;
        } else if (headline.actual < headline.promise) {
            what = `${headline.name} missed their ${headline.promise} promise — only took ${headline.actual} (${formatScore(headline.score)}).`;
        } else if (headline.promise > 0 && headline.actual >= headline.promise * 2) {
            what = `${headline.name} over-extended on a ${headline.promise} promise — took ${headline.actual} (${formatScore(headline.score)}).`;
        } else {
            const extras = headline.actual - headline.promise;
            what = extras > 0
                ? `${headline.name} hit ${formatScore(headline.score)} (promise ${headline.promise}, took ${headline.actual}).`
                : `${headline.name} hit their ${headline.promise} promise exactly (${formatScore(headline.score)}).`;
        }

        // ── WHY — frame the standing after this round ────────────────────────
        let why;
        if (lead === 0) {
            why = `Scores are level at ${s1}.`;
        } else {
            const trailerSide = leader === 'team1' ? 'team2' : 'team1';
            const trailerRecent = recentAvg(match, trailerSide, 3);
            if (trailerRecent < 0) {
                why = `${leaderName} leads by ${absLead}. ${trailerName} has averaged ${trailerRecent} over the last 3 rounds.`;
            } else if (absLead >= 200) {
                why = `${leaderName} leads by ${absLead} — a commanding gap.`;
            } else if (absLead <= 40) {
                why = `${leaderName} edges ${trailerName} by just ${absLead}.`;
            } else {
                why = `${leaderName} leads ${trailerName} by ${absLead}.`;
            }
        }

        // ── NEXT — what could change in the upcoming round ───────────────────
        const pressure = pressureState(match);
        let next;
        if (pressure === 'match-point') {
            if (leader) {
                const toWin = 500 - (leader === 'team1' ? s1 : s2);
                next = `Match point — ${leaderName} needs just ${toWin} more to close it.`;
            } else {
                next = 'Match point — either side can win it this round.';
            }
        } else if (leader && absLead < 140) {
            next = `A blind from ${trailerName} flips momentum — they trail by less than +140.`;
        } else if (leader && absLead >= 140 && absLead < 240) {
            next = `${trailerName} needs a blind plus a strong round to claw back.`;
        } else if (leader) {
            next = `Without a blind, ${trailerName} stays behind.`;
        } else {
            next = 'Either team can take the lead with a single strong round.';
        }

        return { what, why, next };
    }

    function formatScore(n) {
        const v = Number(n);
        if (v > 0) return `+${v}`;
        return String(v); // negative numbers already carry their sign
    }

    // ─── previewScore — used by the Game Board's live score panel (§3.0) ────
    // Classifies a (promise, actual, blind) triple and returns the score plus
    // a short uppercase label for the preview panel.
    //
    // Returns: { score, kind, label }
    //   kind ∈ 'met' | 'over' | 'under' | 'blind-hit' | 'blind-miss' | 'invalid'
    //
    // Falls back to a local scoring computation when the global Match class
    // isn't available (Node tests). Matches CLAUDE.md §4 evaluation order.
    function previewScore(promise, actual, blind) {
        const p = Number(promise);
        const a = Number(actual);
        const b = !!blind;

        // Invalid inputs short-circuit so the UI can render a placeholder.
        if (!Number.isFinite(a) || a < 0 || a > 13) return { score: 0, kind: 'invalid', label: '—' };
        if (b) {
            const score = a >= 7 ? 140 : -70;
            return {
                score,
                kind: score > 0 ? 'blind-hit' : 'blind-miss',
                label: score > 0 ? 'BLIND!' : 'BLIND MISS',
            };
        }
        if (!Number.isFinite(p) || p < 4 || p > 13) return { score: 0, kind: 'invalid', label: '—' };

        let score;
        if (typeof globalThis.Match !== 'undefined' && typeof globalThis.Match.computeScore === 'function') {
            score = globalThis.Match.computeScore(p, a, { blind: false });
        } else {
            // Local mirror of CLAUDE.md §4 priority order.
            if (a < p) score = -(p * 10);
            else if (a >= p * 2) score = -(p * 10);
            else score = (p * 10) + (a - p);
        }

        if (a < p) return { score, kind: 'under', label: 'UNDER-PROMISE' };
        if (a >= p * 2) return { score, kind: 'over', label: 'OVER-EXTENSION' };
        const extras = a - p;
        return {
            score,
            kind: 'met',
            label: extras > 0 ? `MET + ${extras} EXTRA${extras === 1 ? '' : 'S'}` : 'MET',
        };
    }

    return { pressureState, narrate, previewScore };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Narrate;
}
