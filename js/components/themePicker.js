/**
 * §3b.5 Theme Picker — choose icon + pattern for a team.
 *
 * Color stays deterministic (StatsUtils.teamColor). Sound + per-achievement
 * badges are explicitly out of scope.
 *
 * Persistence: writes `team.theme = { iconKey, patternKey }` via
 * `firebaseService.updateTeam(id, { theme })`. "Reset to default" deletes
 * both keys so the hash-derived fallback takes over again.
 *
 * Wiring: caller invokes `ThemePicker.open(team)` after loading the team
 * from the service. Picker uses the global `showModal` / `closeModal` and
 * `showNotification`, the existing `teamService.firebaseService`, and
 * `TeamMark.render` for the live preview.
 */
const ThemePicker = (() => {
    let _draft = null; // { iconKey | null, patternKey | null }
    let _team = null;

    function open(team) {
        _team = team;
        _draft = {
            iconKey: team?.theme?.iconKey || null,
            patternKey: team?.theme?.patternKey || null,
        };
        if (typeof showModal !== 'function') return;

        showModal(`
            <div class="theme-picker">
                <h2>Theme — ${escapeHtmlLocal(team.name)}</h2>
                <p class="td-meta" style="margin-top: -4px; color: var(--fg-muted-2); font-size: 13px;">
                    Color is deterministic and stays in sync across the app. Pick an icon and pattern.
                </p>

                <div class="theme-picker-preview" id="themePickerPreview">
                    <!-- mark + name; refreshed on every selection -->
                </div>

                <div class="theme-picker-section">
                    <h4>Icon</h4>
                    <div class="theme-picker-grid" id="themePickerIcons"></div>
                </div>

                <div class="theme-picker-section">
                    <h4>Pattern</h4>
                    <div class="theme-picker-grid" id="themePickerPatterns"></div>
                </div>

                <div class="theme-picker-actions">
                    <button type="button" id="themePickerReset" class="action-btn secondary">Reset to default</button>
                    <button type="button" id="themePickerCancel" class="action-btn secondary">Cancel</button>
                    <button type="button" id="themePickerSave"   class="action-btn">Save</button>
                </div>
            </div>
        `);

        renderIcons();
        renderPatterns();
        renderPreview();
        wireActions();
    }

    function renderIcons() {
        const host = document.getElementById('themePickerIcons');
        if (!host) return;
        host.innerHTML = StatsUtils.ICON_SET.map(({ key, glyph }) => {
            const selected = _draft.iconKey === key
                || (!_draft.iconKey && StatsUtils.teamIcon(_team).key === key);
            return `<button type="button" class="tp-cell ${selected ? 'is-selected' : ''}"
                            data-icon-key="${key}" title="${key}">${glyph}</button>`;
        }).join('');
        host.querySelectorAll('.tp-cell').forEach(btn => {
            btn.addEventListener('click', () => {
                _draft.iconKey = btn.dataset.iconKey;
                renderIcons();
                renderPreview();
            });
        });
    }

    function renderPatterns() {
        const host = document.getElementById('themePickerPatterns');
        if (!host) return;
        const color = StatsUtils.teamColor(_team.id);
        host.innerHTML = StatsUtils.PATTERN_SET.map(({ key }) => {
            const selected = _draft.patternKey === key
                || (!_draft.patternKey && StatsUtils.teamPattern(_team).key === key);
            return `<button type="button" class="tp-cell ${selected ? 'is-selected' : ''}"
                            data-pattern-key="${key}" title="${key}">
                        <span class="tp-pattern-swatch team-mark" data-pattern="${key}"
                              style="--mark-color:${color}"></span>
                    </button>`;
        }).join('');
        host.querySelectorAll('.tp-cell').forEach(btn => {
            btn.addEventListener('click', () => {
                _draft.patternKey = btn.dataset.patternKey;
                renderPatterns();
                renderPreview();
            });
        });
    }

    function renderPreview() {
        const host = document.getElementById('themePickerPreview');
        if (!host) return;
        // Build a virtual team with the draft applied so TeamMark picks up
        // both override keys at once.
        const virtual = { ..._team, theme: { ..._draft } };
        host.innerHTML = `
            ${TeamMark.render(virtual, { size: 'lg' })}
            <div>
                <div class="tp-name">${escapeHtmlLocal(_team.name)}</div>
                <div class="td-meta" style="color: var(--fg-muted-2); font-size: 13px;">
                    Icon: <strong>${StatsUtils.teamIcon(virtual).key}</strong> · Pattern: <strong>${StatsUtils.teamPattern(virtual).key}</strong>
                </div>
            </div>
        `;
    }

    function wireActions() {
        document.getElementById('themePickerCancel')?.addEventListener('click', closeModal);
        document.getElementById('themePickerReset')?.addEventListener('click', () => {
            _draft = { iconKey: null, patternKey: null };
            renderIcons();
            renderPatterns();
            renderPreview();
        });
        document.getElementById('themePickerSave')?.addEventListener('click', async () => {
            const payload = {};
            if (_draft.iconKey)    payload.iconKey = _draft.iconKey;
            if (_draft.patternKey) payload.patternKey = _draft.patternKey;
            try {
                // If user reset to default, persist an empty theme so subsequent
                // reads from Firestore don't keep stale keys around.
                const themePatch = Object.keys(payload).length
                    ? { theme: payload }
                    : { theme: null };
                await teamService.firebaseService.updateTeam(_team.id, themePatch);
                if (typeof showNotification === 'function') showNotification('Theme saved');
                closeModal();
                if (typeof refreshTeamsList === 'function') refreshTeamsList();
                if (typeof refreshStats === 'function')     refreshStats();
                if (typeof refreshMatchesList === 'function') refreshMatchesList();
            } catch (e) {
                if (typeof showNotification === 'function') {
                    showNotification('Could not save theme — ' + (e?.message || 'unknown error'), 'error');
                }
            }
        });
    }

    function escapeHtmlLocal(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { open };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemePicker;
}
