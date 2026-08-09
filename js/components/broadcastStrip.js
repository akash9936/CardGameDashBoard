/**
 * Broadcast Strip — the narrator layer above any live or just-completed match.
 *
 * Spec: claude/ui-stats-improvements.md §3b.1
 *   - 3 lines: WHAT (fact) · WHY (meaning) · NEXT (implication)
 *   - Left-edge accent in the acting team's color
 *   - Cross-fades content on data change; never slides or pulses
 *
 * Depends on:
 *   - Narrate.narrate, Narrate.pressureState  (js/utils/narrate.js)
 *   - StatsUtils.teamColor                    (js/utils/stats.js)
 *
 * Render is a pure HTML string. Mounting is optional and only needed if you
 * want the cross-fade between updates of the same match instance.
 */
const BroadcastStrip = (() => {
    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // The acting team for the accent bar is whoever drove the last round
    // (largest |score|). Falls back to team1 before any rounds exist.
    function actingTeamId(match) {
        const rounds = Array.isArray(match?.rounds) ? match.rounds : [];
        const last = rounds[rounds.length - 1];
        if (!last) return match?.team1Id;
        const s1 = Math.abs(Number(last.team1?.score || 0));
        const s2 = Math.abs(Number(last.team2?.score || 0));
        return s1 >= s2 ? match.team1Id : match.team2Id;
    }

    function render(match, teams) {
        if (!match) return '';
        // Don't render for pending matches — there's no broadcast yet.
        if (match.status === 'pending' || match.status === 'cancelled') return '';

        const lines = Narrate.narrate(match, teams);
        const pressure = Narrate.pressureState(match);
        const accentId = actingTeamId(match);
        const accent = typeof StatsUtils !== 'undefined' && accentId
            ? StatsUtils.teamColor(accentId)
            : 'var(--info)';

        const matchPointChip = pressure === 'match-point'
            ? '<span class="bs-chip bs-match-point">MATCH POINT</span>'
            : '';

        return `
            <div class="broadcast-strip pressure-${pressure}"
                 data-match-id="${escape(match.id)}"
                 style="--bs-accent: ${accent};"
                 role="region"
                 aria-label="Live match commentary">
                <div class="bs-accent-bar" aria-hidden="true"></div>
                <div class="bs-body">
                    <div class="bs-line bs-what">
                        <span class="bs-text">${escape(lines.what)}</span>
                        <span class="bs-label">WHAT</span>
                    </div>
                    <div class="bs-line bs-why">
                        <span class="bs-text">${escape(lines.why)}</span>
                        <span class="bs-label">WHY</span>
                    </div>
                    <div class="bs-line bs-next">
                        <span class="bs-text">${escape(lines.next)}</span>
                        <span class="bs-label">NEXT</span>
                    </div>
                </div>
                ${matchPointChip}
            </div>
        `;
    }

    // Cross-fade the textual contents of an already-mounted strip when the
    // underlying match data changes. No-op if the strip can't be found.
    function refresh(matchId, match, teams) {
        const root = document.querySelector(
            `.broadcast-strip[data-match-id="${CSS.escape(String(matchId))}"]`
        );
        if (!root) return;

        const lines = Narrate.narrate(match, teams);
        const pressure = Narrate.pressureState(match);
        const accentId = actingTeamId(match);
        const accent = typeof StatsUtils !== 'undefined' && accentId
            ? StatsUtils.teamColor(accentId)
            : 'var(--info)';

        root.style.setProperty('--bs-accent', accent);
        root.className = `broadcast-strip pressure-${pressure}`;
        root.dataset.matchId = String(matchId);

        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        const setText = (sel, text) => {
            const el = root.querySelector(sel);
            if (!el) return;
            if (reduced) { el.textContent = text; return; }
            el.style.transition = 'opacity 200ms var(--ease-out)';
            el.style.opacity = '0';
            setTimeout(() => {
                el.textContent = text;
                el.style.opacity = '1';
            }, 200);
        };

        setText('.bs-what .bs-text', lines.what);
        setText('.bs-why .bs-text',  lines.why);
        setText('.bs-next .bs-text', lines.next);

        // Match-point chip toggle.
        const existing = root.querySelector('.bs-match-point');
        if (pressure === 'match-point' && !existing) {
            const chip = document.createElement('span');
            chip.className = 'bs-chip bs-match-point';
            chip.textContent = 'MATCH POINT';
            root.appendChild(chip);
        } else if (pressure !== 'match-point' && existing) {
            existing.remove();
        }
    }

    return { render, refresh };
})();

// Node export for tests, harmless in browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BroadcastStrip;
}
