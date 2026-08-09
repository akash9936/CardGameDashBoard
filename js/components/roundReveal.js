/**
 * Round Reveal — the 1.6s sequence after a round is committed.
 *
 * Spec: claude/ui-stats-improvements.md §3.1
 *   - Fade old form / slide reveal in
 *   - Count-up round score, 700ms ease-out-expo
 *   - Outcome stamp pop (MET / BLIND! / OVER / UNDER)
 *   - Per-outcome flourish (blind→confetti, over→shake, met→check)
 *
 * Mount with: RoundReveal.show(match, teams)
 * Returns a Promise that resolves when the sequence is complete so callers
 * can chain (e.g. show the Winner Moment after the reveal lands).
 */
const RoundReveal = (() => {
    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function classify(side) {
        if (!side) return 'neutral';
        const blind = side.blind === true || (side.promise === 7 && (side.score === 140 || side.score === -70));
        if (blind) return Number(side.score) > 0 ? 'blind-hit' : 'blind-miss';
        const promise = Number(side.promise || 0);
        const actual = Number(side.actual || 0);
        if (actual < promise) return 'under';
        if (promise > 0 && actual >= promise * 2) return 'over';
        return 'met';
    }

    function stampCopy(kind) {
        switch (kind) {
            case 'blind-hit':  return '🃏 BLIND!';
            case 'blind-miss': return '🃏 MISSED';
            case 'over':       return 'OVER-EXTENSION';
            case 'under':      return 'UNDER';
            case 'met':        return 'MET';
            default:           return '';
        }
    }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : 'Team';
    }

    /**
     * Show the reveal for the most-recent round of `match`.
     * Resolves after the full sequence (~1.6s, or ~50ms under reduced-motion).
     */
    function show(match, teams) {
        return new Promise(resolve => {
            const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
            if (!rounds.length) { resolve(); return; }
            const round = rounds[rounds.length - 1];

            const t1Name = teamName(teams, match.team1Id);
            const t2Name = teamName(teams, match.team2Id);
            const t1Class = classify(round.team1);
            const t2Class = classify(round.team2);
            const t1Color = typeof StatsUtils !== 'undefined' ? StatsUtils.teamColor(match.team1Id) : 'var(--info)';
            const t2Color = typeof StatsUtils !== 'undefined' ? StatsUtils.teamColor(match.team2Id) : 'var(--info)';

            const overlay = document.createElement('div');
            overlay.className = 'reveal-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', `Round ${round.roundNumber} result`);
            overlay.innerHTML = `
                <div class="reveal-card">
                    <div class="reveal-round-label">ROUND ${round.roundNumber}</div>
                    <div class="reveal-grid">
                        ${renderSide('team1', t1Name, round.team1, t1Class, t1Color)}
                        ${renderSide('team2', t2Name, round.team2, t2Class, t2Color)}
                    </div>
                    <button type="button" class="reveal-dismiss action-btn">Next round →</button>
                </div>
            `;
            document.body.appendChild(overlay);

            // Click anywhere outside the card, or press the button, to skip.
            const dismiss = () => {
                if (!overlay.parentNode) return;
                overlay.classList.add('reveal-out');
                setTimeout(() => overlay.remove(), 200);
                resolve();
            };
            overlay.querySelector('.reveal-dismiss').addEventListener('click', dismiss);
            overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
            const escHandler = e => {
                if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', escHandler); }
            };
            document.addEventListener('keydown', escHandler);

            // Auto-dismiss after 4 seconds if the user doesn't act.
            const auto = setTimeout(dismiss, 4000);
            overlay.addEventListener('click', () => clearTimeout(auto), { once: true });

            // Kick off the per-side animations.
            requestAnimationFrame(() => runSide(overlay, 'team1', round.team1, t1Class, t1Color));
            requestAnimationFrame(() => runSide(overlay, 'team2', round.team2, t2Class, t2Color));

            // If neither side was blind/over, no flourish needed — just resolve
            // once the reveal has been on screen for the count-up duration.
        });
    }

    function renderSide(sideKey, name, side, kind, color) {
        const score = Number(side?.score || 0);
        const promise = Number(side?.promise || 0);
        const actual = Number(side?.actual || 0);
        const blind = side?.blind === true;
        return `
            <div class="reveal-side reveal-${kind}" data-side="${sideKey}" style="--rv-accent: ${color};">
                <div class="reveal-team-name">${escape(name)}</div>
                <div class="reveal-meta">
                    Promise <strong>${blind ? 'BLIND (7)' : promise}</strong>
                    · Actual <strong>${actual}</strong>
                </div>
                <div class="reveal-score-wrap">
                    <div class="reveal-score numeric" data-target="${score}">0</div>
                    <div class="reveal-stamp">${stampCopy(kind)}</div>
                </div>
            </div>
        `;
    }

    function runSide(overlay, sideKey, side, kind, color) {
        const sideEl = overlay.querySelector(`.reveal-side[data-side="${sideKey}"]`);
        if (!sideEl) return;
        const scoreEl = sideEl.querySelector('.reveal-score');
        const stampEl = sideEl.querySelector('.reveal-stamp');
        const targetScore = Number(side?.score || 0);

        // Stamp pops in immediately.
        requestAnimationFrame(() => stampEl.classList.add('show'));

        // Score counts up.
        if (typeof Animate !== 'undefined') {
            Animate.countUp(scoreEl, 0, targetScore, 700);
        } else {
            scoreEl.textContent = targetScore > 0 ? `+${targetScore}` : String(targetScore);
        }

        // Per-outcome flourish.
        setTimeout(() => {
            if (kind === 'blind-hit') {
                if (typeof Animate !== 'undefined') {
                    Animate.burstConfetti({
                        particleCount: 80, spread: 60,
                        origin: { x: sideKey === 'team1' ? 0.3 : 0.7, y: 0.4 },
                        colors: [color, '#F2C84A'],
                    });
                }
            } else if (kind === 'over') {
                sideEl.classList.add('shake');
                setTimeout(() => sideEl.classList.remove('shake'), 400);
            }
        }, 600);
    }

    return { show };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RoundReveal;
}
