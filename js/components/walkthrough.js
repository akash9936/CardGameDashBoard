/**
 * First-Time Viewer Walkthrough — 5 progressive overlay frames.
 *
 * Spec: claude/ui-stats-improvements.md §3b.3
 *
 * Triggers automatically the first time the user lands on the Matches
 * section while at least one match is in_progress. Persisted as
 * localStorage 'cg.walkthroughSeen'. The "Replay walkthrough" affordance
 * lives in the header (set via Walkthrough.attachReplayButton()).
 */
const Walkthrough = (() => {
    const KEY = 'cg.walkthroughSeen';

    const FRAMES = [
        { selector: '.gb-team-name',       copy: 'Each team <strong>promises</strong> how many hands they\'ll take.' },
        { selector: '.gb-chip-grid',       copy: 'Promises run <strong>4 to 13</strong>. Or call <strong>🃏 BLIND</strong> — locked at 7.' },
        { selector: '.gb-actual-slider',   copy: 'The two teams\' <strong>actuals</strong> always add up to <strong>13</strong>.' },
        { selector: '[data-preview]',      copy: 'Hit your promise → score. Miss → minus. Take 2× → also minus.' },
        { selector: '.worm-chart, canvas.sparkline, .match-card', copy: 'First to <strong>500</strong> wins. Watch the lines race.' },
    ];

    let _state = null;

    function seen() {
        try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
    }
    function markSeen() {
        try { localStorage.setItem(KEY, '1'); } catch (_) { /* private mode */ }
    }

    function findAnchor(selector) {
        if (!selector) return null;
        // Take the first visible match.
        for (const el of document.querySelectorAll(selector)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return null;
    }

    function positionCard(card, anchorRect) {
        // Place above the anchor when there's room, otherwise below.
        const margin = 16;
        const cardRect = card.getBoundingClientRect();
        const above = anchorRect.top - cardRect.height - margin;
        const below = anchorRect.bottom + margin;
        const fitsAbove = above > 16;

        let top, arrow;
        if (fitsAbove) {
            top = above;
            arrow = 'arrow-down';
        } else {
            top = Math.min(below, window.innerHeight - cardRect.height - 16);
            arrow = 'arrow-up';
        }
        let left = anchorRect.left + anchorRect.width / 2 - cardRect.width / 2;
        left = Math.max(16, Math.min(left, window.innerWidth - cardRect.width - 16));

        card.style.top = `${Math.max(16, top)}px`;
        card.style.left = `${left}px`;
        card.classList.remove('arrow-up', 'arrow-down');
        card.classList.add(arrow);
    }

    function highlight(anchorRect, layer) {
        const ring = layer.querySelector('.wt-ring');
        if (!anchorRect) { ring.style.display = 'none'; return; }
        ring.style.display = 'block';
        ring.style.top = `${anchorRect.top - 6}px`;
        ring.style.left = `${anchorRect.left - 6}px`;
        ring.style.width = `${anchorRect.width + 12}px`;
        ring.style.height = `${anchorRect.height + 12}px`;
    }

    function showFrame(index) {
        if (!_state) return;
        // Skip frames whose anchor isn't on screen — they'd just confuse.
        while (index < FRAMES.length && !findAnchor(FRAMES[index].selector)) index++;
        if (index >= FRAMES.length) { finish(); return; }

        _state.index = index;
        const frame = FRAMES[index];
        const anchor = findAnchor(frame.selector);
        const rect = anchor.getBoundingClientRect();

        const layer = _state.layer;
        const card = layer.querySelector('.wt-card');
        card.querySelector('.wt-copy').innerHTML = frame.copy;
        card.querySelector('.wt-step').textContent = `Step ${index + 1} of ${FRAMES.length}`;
        const nextBtn = card.querySelector('.wt-next');
        nextBtn.textContent = (index === FRAMES.length - 1) ? 'Got it!' : 'Next →';

        // Two paints needed: one to apply text, one to read updated rect.
        requestAnimationFrame(() => {
            positionCard(card, rect);
            highlight(rect, layer);
        });
    }

    function finish() {
        markSeen();
        if (_state?.layer?.parentNode) _state.layer.remove();
        if (_state?.scrollHandler) window.removeEventListener('scroll', _state.scrollHandler, true);
        if (_state?.resizeHandler) window.removeEventListener('resize', _state.resizeHandler);
        _state = null;
    }

    function start(opts = {}) {
        if (_state) return; // already running
        // Require at least one live match to anchor against.
        const anyAnchor = FRAMES.some(f => findAnchor(f.selector));
        if (!anyAnchor && !opts.force) return;

        const layer = document.createElement('div');
        layer.className = 'wt-layer';
        layer.innerHTML = `
            <div class="wt-backdrop"></div>
            <div class="wt-ring"></div>
            <div class="wt-card" role="dialog" aria-modal="true" aria-label="Walkthrough">
                <div class="wt-step">Step 1 of ${FRAMES.length}</div>
                <p class="wt-copy"></p>
                <div class="wt-actions">
                    <button type="button" class="wt-skip">Skip</button>
                    <button type="button" class="wt-next action-btn">Next →</button>
                </div>
            </div>
        `;
        document.body.appendChild(layer);

        _state = { layer, index: 0 };

        layer.querySelector('.wt-skip').addEventListener('click', finish);
        layer.querySelector('.wt-next').addEventListener('click', () => showFrame(_state.index + 1));
        layer.querySelector('.wt-backdrop').addEventListener('click', finish);
        const esc = e => { if (e.key === 'Escape') finish(); };
        document.addEventListener('keydown', esc, { once: false });
        _state.escHandler = esc;

        const reposition = () => {
            const f = FRAMES[_state.index];
            const a = findAnchor(f.selector);
            if (a) {
                const r = a.getBoundingClientRect();
                positionCard(_state.layer.querySelector('.wt-card'), r);
                highlight(r, _state.layer);
            }
        };
        _state.scrollHandler = reposition;
        _state.resizeHandler = reposition;
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);

        showFrame(0);
    }

    function maybeAutoStart() {
        if (seen()) return;
        // Run after a brief delay so the matches list has rendered.
        setTimeout(() => start(), 400);
    }

    function attachReplayButton(button) {
        if (!button) return;
        button.addEventListener('click', () => start({ force: true }));
    }

    return { start, maybeAutoStart, attachReplayButton };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Walkthrough;
}
