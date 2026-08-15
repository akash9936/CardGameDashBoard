/**
 * Broadcast Strip — the narrator layer above any live or just-completed match.
 *
 * Spec: claude/ui-stats-improvements.md §3b.1
 *   - 3 lines: WHAT (fact) · WHY (meaning) · NEXT (implication)
 *   - Left-edge accent in the acting team's color
 *   - Cross-fades content on data change; never slides or pulses
 *   - A collapsed history drawer below it, holding every line already said
 *     this match (CommentaryLog). The strip stays a "now" surface; the
 *     scrollback lives one click down, closed by default.
 *
 * Depends on:
 *   - Narrate.narrate, Narrate.pressureState  (js/utils/narrate.js)
 *   - StatsUtils.teamColor                    (js/utils/stats.js)
 *   - CommentaryLog                           (js/utils/commentaryLog.js)
 *
 * Render is a pure HTML string. Mounting is optional and only needed if you
 * want the cross-fade between updates of the same match instance.
 */
const BroadcastStrip = (() => {
    // The transcript store. In the browser commentaryLog.js is a classic
    // script whose top-level `const` lands in *script scope*, not on
    // globalThis — so the bare name is what resolves, and a
    // `globalThis.CommentaryLog` probe would miss it and silently disable the
    // drawer. In Node the bare name doesn't exist and require() supplies it.
    // Optional either way: without it the strip renders as it did before.
    const _log = (typeof CommentaryLog !== 'undefined')
        ? CommentaryLog
        : (typeof require === 'function' ? require('../utils/commentaryLog.js') : undefined);

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

    // ─── History drawer ──────────────────────────────────────────────────────
    // Every line the broadcast has already said this match, oldest at the top,
    // so it reads as a transcript. Collapsed by default: the strip's job is to
    // show the current moment, and an always-open log would bury it.

    // Where each kind of line came from, as a short badge. Distinguishing them
    // matters — a spoken AI line and the on-screen narration for the same round
    // say different things, and the reader should know which they are looking
    // at without guessing from the wording.
    const KIND_LABEL = {
        start:  { icon: '🎬', label: 'START' },
        round:  { icon: '📋', label: 'ROUND' },
        spoken: { icon: '🔊', label: 'SAID' },
        pundit: { icon: '✨', label: 'AI' },
        result: { icon: '🏆', label: 'RESULT' },
    };

    function timeOf(ms) {
        if (!ms) return '';
        try {
            return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '';
        }
    }

    function renderHistoryEntry(entry) {
        const meta = KIND_LABEL[entry.kind] || KIND_LABEL.round;
        const roundTag = entry.round > 0 ? `R${entry.round}` : '';
        // The three-part narration keeps its structure; a spoken or AI line is
        // a single sentence and renders as one.
        const detail = (entry.why || entry.next)
            ? `<div class="ch-detail">${[entry.why, entry.next].filter(Boolean).map(escape).join(' · ')}</div>`
            : '';
        return `
            <li class="ch-entry ch-${escape(entry.kind)}">
                <div class="ch-meta">
                    <span class="ch-icon" aria-hidden="true">${meta.icon}</span>
                    ${roundTag ? `<span class="ch-round">${escape(roundTag)}</span>` : ''}
                    <span class="ch-kind">${escape(meta.label)}</span>
                    <span class="ch-time">${escape(timeOf(entry.at))}</span>
                </div>
                <div class="ch-text">${escape(entry.text)}</div>
                ${detail}
            </li>
        `;
    }

    function historyEntries(matchId) {
        if (!_log) return [];
        return _log.entries(matchId);
    }

    function renderHistory(match) {
        const log = historyEntries(match.id);
        // Nothing said yet — render no toggle at all rather than an empty
        // drawer that promises something and delivers nothing.
        if (!log.length) return '';

        return `
            <div class="bs-history" data-match-id="${escape(match.id)}">
                <button type="button" class="ch-toggle"
                        data-match-id="${escape(match.id)}"
                        aria-expanded="false">
                    <span class="ch-toggle-label">Commentary history</span>
                    <span class="ch-count">${log.length}</span>
                    <span class="ch-caret" aria-hidden="true">▾</span>
                </button>
                <div class="ch-panel" hidden>
                    <ol class="ch-list">
                        ${log.map(renderHistoryEntry).join('')}
                    </ol>
                </div>
            </div>
        `;
    }

    // Open/close the drawer. Delegated from a container so it survives the
    // innerHTML swaps that refreshMatchesList does on every round.
    function wireHistory(root = document) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        root.querySelectorAll('.ch-toggle').forEach(btn => {
            if (btn.dataset.chWired === '1') return;
            btn.dataset.chWired = '1';
            btn.addEventListener('click', () => {
                const drawer = btn.closest('.bs-history');
                const panel = drawer?.querySelector('.ch-panel');
                if (!panel) return;
                const open = btn.getAttribute('aria-expanded') === 'true';
                btn.setAttribute('aria-expanded', String(!open));
                panel.hidden = open;
                drawer.classList.toggle('open', !open);
                // Opening lands the reader on the most recent line, which is
                // the one they most likely missed.
                if (!open) panel.scrollTop = panel.scrollHeight;
            });
        });
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
                    ${renderHistory(match)}
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

    // Capture the current narration into the history log. Called once per
    // round, right after the round lands and before the list re-renders, so
    // the drawer that renders a moment later already contains this line.
    //
    // Idempotent by way of CommentaryLog's dedupe on kind:round — a re-submit
    // or a snapshot echo for the same round appends nothing.
    function logRound(match, teams) {
        if (!_log || !match) return null;
        if (match.status === 'pending' || match.status === 'cancelled') return null;

        const lines = Narrate.narrate(match, teams);
        if (!lines || !lines.what) return null;

        const rounds = Array.isArray(match.rounds) ? match.rounds : [];
        // A completed match's last narration is the result, not a round — it
        // reads as "X won" and deserves its own badge in the transcript.
        const kind = match.status === 'completed' ? 'result' : 'round';

        return _log.append(match.id, {
            kind,
            round: rounds.length,
            text: lines.what,
            why: lines.why,
            next: lines.next,
        });
    }

    return { render, refresh, logRound, renderHistory, wireHistory };
})();

// Node export for tests, harmless in browser.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BroadcastStrip;
}
