/**
 * Winner Moment — the post-match overlay.
 *
 * Spec: claude/ui-stats-improvements.md §3.3
 *   - Winning team name + final score + round count
 *   - 2-sentence match story (from Narrate.narrate)
 *   - 3-card Moment Reel (from StatsUtils.momentReel)
 *   - Double confetti burst in team palette
 *   - [Share] (clipboard) + [Back] actions
 */
const WinnerMoment = (() => {
    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function teamName(teams, id) {
        const t = (teams || []).find(x => String(x.id) === String(id));
        return t ? t.name : 'Team';
    }

    function formatScore(n) {
        const v = Number(n);
        return v > 0 ? `+${v}` : String(v);
    }

    function buildShareText(match, teams) {
        const t1 = teamName(teams, match.team1Id);
        const t2 = teamName(teams, match.team2Id);
        const s1 = Number(match.finalScore?.team1 || 0);
        const s2 = Number(match.finalScore?.team2 || 0);
        const winner = String(match.winnerId) === String(match.team1Id) ? t1 : t2;
        const winScore = winner === t1 ? s1 : s2;
        const lossScore = winner === t1 ? s2 : s1;
        const rounds = (match.rounds || []).length;
        return `${winner} beat ${winner === t1 ? t2 : t1} ${winScore}–${lossScore} in ${rounds} rounds.`;
    }

    function reelCard(entry, teams) {
        if (!entry) return '';
        const t = (teams || []).find(x => String(x.id) === String(entry.sideId));
        const accent = typeof StatsUtils !== 'undefined' && entry.sideId
            ? StatsUtils.teamColor(entry.sideId)
            : 'var(--info)';
        const tname = t ? t.name : '';
        const valueText = entry.delta != null
            ? `R${entry.roundNumber} · Δ ${entry.delta}`
            : `R${entry.roundNumber} · ${formatScore(entry.score)}`;
        return `
            <div class="reel-card" style="--rl-accent: ${accent};">
                <div class="reel-label">${escape(entry.label)}</div>
                <div class="reel-value numeric">${escape(valueText)}</div>
                <div class="reel-team">${escape(tname)}</div>
            </div>
        `;
    }

    function show(match, teams) {
        if (!match || match.status !== 'completed') return;

        const t1Name = teamName(teams, match.team1Id);
        const t2Name = teamName(teams, match.team2Id);
        const s1 = Number(match.finalScore?.team1 || 0);
        const s2 = Number(match.finalScore?.team2 || 0);
        const winnerId = match.winnerId;
        const winnerName = String(winnerId) === String(match.team1Id) ? t1Name
                         : String(winnerId) === String(match.team2Id) ? t2Name
                         : null;
        const winnerColor = (typeof StatsUtils !== 'undefined' && winnerId)
            ? StatsUtils.teamColor(winnerId)
            : 'var(--info)';
        const otherColor = (typeof StatsUtils !== 'undefined')
            ? StatsUtils.teamColor(String(winnerId) === String(match.team1Id) ? match.team2Id : match.team1Id)
            : 'var(--neutral)';

        const reel = (typeof StatsUtils !== 'undefined') ? StatsUtils.momentReel(match) : {};
        const lines = (typeof Narrate !== 'undefined') ? Narrate.narrate(match, teams) : null;

        const overlay = document.createElement('div');
        overlay.className = 'winner-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', `${winnerName || 'Match'} winner`);
        overlay.style.setProperty('--wm-accent', winnerColor);

        const rounds = (match.rounds || []).length;
        const winnerFinal = winnerName === t1Name ? s1 : s2;
        const otherFinal = winnerName === t1Name ? s2 : s1;

        const winnerTeam = (Array.isArray(teams) ? teams : []).find(t => String(t.id) === String(winnerId));
        const markHtml = (typeof TeamMark !== 'undefined' && winnerTeam)
            ? TeamMark.render(winnerTeam, { size: 'lg' })
            : '';

        overlay.innerHTML = `
            <div class="winner-card">
                <div class="winner-label">WINNER</div>
                ${markHtml ? `<div class="winner-mark">${markHtml}</div>` : ''}
                <div class="winner-name">${escape(winnerName || 'Match complete')}</div>
                <div class="winner-final-score">
                    <span class="winner-score numeric" data-target="${winnerFinal}">0</span>
                    <span class="winner-dash">–</span>
                    <span class="loser-score numeric" data-target="${otherFinal}">0</span>
                </div>
                <div class="winner-round-count">in ${rounds} round${rounds === 1 ? '' : 's'}</div>

                ${lines ? `
                    <p class="winner-story">${escape(lines.what)} ${escape(lines.why)}</p>
                ` : ''}

                <div class="reel-grid">
                    ${reelCard(reel?.biggestSwing, teams)}
                    ${reelCard(reel?.bestBlind, teams)}
                    ${reelCard(reel?.worstCall, teams)}
                </div>

                <div class="winner-actions">
                    <button type="button" class="action-btn wm-share">📋 Copy summary</button>
                    <button type="button" class="action-btn secondary wm-close">Back to matches</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Count up the final scores (unsigned — these are cumulative totals).
        const winEl = overlay.querySelector('.winner-score');
        const loseEl = overlay.querySelector('.loser-score');
        if (typeof Animate !== 'undefined') {
            Animate.countUp(winEl, 0, winnerFinal, 1200, v => String(Math.round(v)));
            Animate.countUp(loseEl, 0, otherFinal, 1200, v => String(Math.round(v)));
        } else {
            winEl.textContent = winnerFinal;
            loseEl.textContent = otherFinal;
        }

        // Confetti burst in winning team colors.
        if (typeof Animate !== 'undefined') {
            setTimeout(() => Animate.winnerConfetti([winnerColor, otherColor, '#F2C84A']), 300);
        }

        const close = () => {
            if (!overlay.parentNode) return;
            overlay.classList.add('winner-out');
            setTimeout(() => overlay.remove(), 250);
        };
        overlay.querySelector('.wm-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function escClose(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); }
        });

        // Share button: copy text to clipboard, or fall back to native share.
        const shareBtn = overlay.querySelector('.wm-share');
        shareBtn.addEventListener('click', async () => {
            const text = buildShareText(match, teams);
            try {
                if (navigator.share) {
                    await navigator.share({ text });
                } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    shareBtn.textContent = '✓ Copied!';
                    setTimeout(() => { shareBtn.textContent = '📋 Copy summary'; }, 1500);
                }
            } catch (_) {
                /* user cancelled or clipboard blocked */
            }
        });
    }

    return { show };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WinnerMoment;
}
