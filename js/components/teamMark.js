/**
 * §3b.5 Team Mark — color disc + repeating pattern + curated glyph.
 *
 * Pure HTML-string renderer; CSS in `css/styles.css .team-mark{}` does the
 * actual rendering. The pattern is drawn with CSS `background-image`
 * gradients keyed off the `--pattern` data attribute, so no SVG is needed.
 *
 * Usage:
 *   TeamMark.render(team, { size: 'sm' | 'md' | 'lg' })
 *
 * `team` may be either a full team object (preferred, so theme overrides
 * apply) or a bare id (deterministic-only).
 */
const TeamMark = (() => {
    const SIZE_PX = { sm: 16, md: 32, lg: 96 };

    function render(team, opts = {}) {
        const size = opts.size && SIZE_PX[opts.size] ? opts.size : 'sm';
        const id = team && typeof team === 'object' ? team.id : team;
        const color = StatsUtils.teamColor(id);
        const icon = StatsUtils.teamIcon(team);
        const pattern = StatsUtils.teamPattern(team);
        const title = (team && typeof team === 'object' && team.name)
            ? team.name
            : '';
        return `<span class="team-mark team-mark-${size}"
                      data-pattern="${pattern.key}"
                      style="--mark-color:${color}"
                      title="${escapeAttr(title)}"
                      aria-hidden="true">
            <span class="team-mark-glyph">${icon.glyph}</span>
        </span>`.replace(/\s+/g, ' ').trim();
    }

    function escapeAttr(s) {
        return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    return { render, SIZE_PX };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TeamMark;
}
