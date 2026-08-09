/**
 * §3b.4 Spectator Pass — wall-display mode.
 *
 * Auto-engages on `?tv=1`. Otherwise toggleable via header button (◐) or
 * the keyboard ('s'). Hides input controls, scales type up, doubles the
 * broadcast strip, suppresses ambient motion. The class lives on <body> so
 * any CSS can react to it without per-component plumbing.
 *
 * Persistence: localStorage.cg.spectatorPass = '1' | '0' | undefined.
 * URL flag wins on the *initial* load only — after that, user toggle
 * + storage drives state.
 *
 * The pure logic lives in `SpectatorPass.logic` so it can be unit-tested
 * without a DOM.
 */
const SpectatorPass = (() => {
    const BODY_CLASS = 'spectator-pass';
    const STORAGE_KEY = 'cg.spectatorPass';

    // ─── Pure logic (testable without DOM) ─────────────────────────────────
    const logic = {
        /**
         * Decide initial enabled state from URL + storage.
         * URL `?tv=1` forces on. URL `?tv=0` forces off. Otherwise storage
         * value wins; missing storage → off.
         */
        initialEnabled({ search = '', storage = null } = {}) {
            const params = parseQuery(search);
            if (params.tv === '1') return true;
            if (params.tv === '0') return false;
            if (storage === '1') return true;
            return false;
        },

        /**
         * Compute next enabled state from current + intent.
         * Pure — no side effects.
         */
        toggle(current) { return !current; },

        parseQuery,
    };

    function parseQuery(search) {
        if (!search || typeof search !== 'string') return {};
        const s = search.startsWith('?') ? search.slice(1) : search;
        const out = {};
        for (const pair of s.split('&')) {
            if (!pair) continue;
            const eq = pair.indexOf('=');
            const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
            const v = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1));
            if (k) out[k] = v;
        }
        return out;
    }

    // ─── DOM wiring ────────────────────────────────────────────────────────
    let _enabled = false;
    let _toggleBtn = null;

    function isEnabled() { return _enabled; }

    function apply(enabled) {
        _enabled = !!enabled;
        document.body.classList.toggle(BODY_CLASS, _enabled);
        if (_toggleBtn) {
            _toggleBtn.setAttribute('aria-pressed', String(_enabled));
            _toggleBtn.classList.toggle('is-on', _enabled);
            _toggleBtn.title = _enabled
                ? 'Exit Spectator Pass (Esc)'
                : 'Spectator Pass — wall display mode';
        }
    }

    function persist(enabled) {
        try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); }
        catch (_) { /* private mode / quota — ignore */ }
    }

    function readStorage() {
        try { return localStorage.getItem(STORAGE_KEY); }
        catch (_) { return null; }
    }

    function set(enabled) {
        apply(enabled);
        persist(enabled);
    }

    function toggle() { set(!_enabled); }

    function init() {
        if (typeof document === 'undefined') return;
        _toggleBtn = ensureButton();

        const initial = logic.initialEnabled({
            search: typeof window !== 'undefined' ? window.location.search : '',
            storage: readStorage(),
        });
        apply(initial);

        if (_toggleBtn && !_toggleBtn.dataset.wired) {
            _toggleBtn.dataset.wired = '1';
            _toggleBtn.addEventListener('click', toggle);
        }

        // Esc exits. Plain 's' toggles (skipped while typing in an input).
        if (!document.body.dataset.spWired) {
            document.body.dataset.spWired = '1';
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && _enabled) { e.preventDefault(); set(false); return; }
                if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                    const tag = (e.target?.tagName || '').toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                    if (e.target?.isContentEditable) return;
                    e.preventDefault();
                    toggle();
                }
            });
        }
    }

    function ensureButton() {
        let btn = document.getElementById('spectatorPassToggle');
        if (btn) return btn;
        const stickyButtons = document.querySelector('.sticky-nav .sticky-nav-buttons');
        if (!stickyButtons) return null;
        btn = document.createElement('button');
        btn.id = 'spectatorPassToggle';
        btn.type = 'button';
        btn.className = 'sticky-nav-btn sp-toggle';
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Toggle Spectator Pass');
        btn.innerHTML = '<span class="sp-glyph" aria-hidden="true">◐</span><span class="sp-label">TV</span>';
        stickyButtons.appendChild(btn);
        return btn;
    }

    return { init, toggle, set, isEnabled, logic };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpectatorPass;
}
