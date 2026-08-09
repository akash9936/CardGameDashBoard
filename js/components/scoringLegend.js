/**
 * Scoring Legend — collapsible "HOW SCORING WORKS" card on the Stats page.
 *
 * Spec: claude/ui-stats-improvements.md §5.1
 *   - 4 example rows pulled directly from CLAUDE.md §4
 *   - Default open on first visit, persists dismissed state in localStorage
 *
 * Mounts into <div id="scoringLegendSlot"> if present; otherwise idempotently
 * prepends a host into the stats section.
 */
const ScoringLegend = (() => {
    const STORAGE_KEY = 'cg.scoringLegend.collapsed';

    const ROWS = [
        { p: '8',         a: '5',  score: '−80',  why: 'Under-promise — forfeit full promise', ref: '§4.1' },
        { p: '8',         a: '10', score: '+82',  why: 'Met + 2 extras',                      ref: '§4.2' },
        { p: '4',         a: '9',  score: '−40',  why: 'Over-extension — Actual ≥ Promise × 2',ref: '§4.3' },
        { p: '7 (Blind)', a: '8',  score: '+140', why: 'Blind success',                        ref: '§4.4' },
    ];

    function render(collapsed) {
        const rows = ROWS.map(r => `
            <tr>
                <td class="sl-num numeric">${r.p}</td>
                <td class="sl-num numeric">${r.a}</td>
                <td class="sl-score numeric" data-sign="${r.score.startsWith('+') ? 'pos' : 'neg'}">${r.score}</td>
                <td class="sl-why">${r.why} <span class="sl-ref">${r.ref}</span></td>
            </tr>
        `).join('');
        return `
            <div class="scoring-legend ${collapsed ? 'is-collapsed' : ''}" data-legend>
                <button type="button" class="sl-toggle" aria-expanded="${!collapsed}">
                    <span class="sl-title">HOW SCORING WORKS</span>
                    <span class="sl-chev" aria-hidden="true">▾</span>
                </button>
                <div class="sl-body" role="region" aria-label="Scoring rules examples">
                    <table class="sl-table">
                        <thead>
                            <tr>
                                <th>Promise</th>
                                <th>Actual</th>
                                <th>Score</th>
                                <th>Why</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                    <p class="sl-foot">Game rules locked in <a href="../CLAUDE.md" target="_blank" rel="noopener">CLAUDE.md §4</a>.</p>
                </div>
            </div>
        `;
    }

    // Idempotent: insert into a host, or create one at the top of the stats section.
    function mount() {
        let host = document.getElementById('scoringLegendSlot');
        if (!host) {
            const section = document.getElementById('statsSection');
            if (!section) return;
            host = document.createElement('div');
            host.id = 'scoringLegendSlot';
            const hotStrip = document.getElementById('hotStrip');
            if (hotStrip?.parentNode === section) {
                section.insertBefore(host, hotStrip);
            } else {
                section.insertBefore(host, section.firstChild?.nextSibling || null);
            }
        }
        // Avoid re-rendering if already mounted (preserves wire state).
        if (host.dataset.mounted === '1') return;
        host.dataset.mounted = '1';

        const collapsed = readCollapsed();
        host.innerHTML = render(collapsed);

        const toggle = host.querySelector('.sl-toggle');
        toggle.addEventListener('click', () => {
            const card = host.querySelector('[data-legend]');
            const isCollapsed = card.classList.toggle('is-collapsed');
            toggle.setAttribute('aria-expanded', String(!isCollapsed));
            writeCollapsed(isCollapsed);
        });
    }

    function readCollapsed() {
        try { return localStorage.getItem(STORAGE_KEY) === '1'; }
        catch (_) { return false; }
    }
    function writeCollapsed(v) {
        try { localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); }
        catch (_) { /* private mode */ }
    }

    return { mount };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScoringLegend;
}
