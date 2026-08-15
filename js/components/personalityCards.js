/**
 * Personality Cards — "what kind of player are you?"
 *
 * The leaderboard answers who is winning. This answers who they ARE: an
 * archetype earned from real play, four trait bars, and a tilt meter.
 *
 * Everything rendered here was computed by SeasonDigest at generation time and
 * shipped inside js/data/seasonFacts.js (`digest.personalities`, `digest.tilt`).
 * This layer does no arithmetic — same contract as the facts board.
 *
 * The tilt meter is the reason this component exists. Measured across the
 * archive: after a NEGATIVE round a team calls blind ~65% of the time; after a
 * positive one, ~21%. Nobody at the table knows this about themselves, which
 * makes it the most interesting true thing in the data.
 *
 * Degrades to nothing when the pack predates these fields.
 */
const PersonalityCards = (() => {

    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function digest() {
        return (typeof SeasonFacts !== 'undefined' && SeasonFacts && SeasonFacts.digest)
            ? SeasonFacts.digest : null;
    }

    // Archetype → the emoji that reads as that personality at a glance.
    const FACES = {
        saint: '😇',
        sniper: '🎯',
        blind_addict: '🕶️',
        tilter: '🤬',
        gambler: '🎲',
        rock: '🧱',
        safe: '🐢',
        workhorse: '🐴',
    };

    // Trait bars. `null` means the season has too little data for that trait
    // (coolHead needs enough bad rounds to measure), and the bar is skipped
    // rather than drawn at zero — an unmeasured trait is not a weak one.
    const TRAITS = [
        { key: 'nerve', label: 'Nerve', hint: 'How often they reach for the blind' },
        { key: 'discipline', label: 'Discipline', hint: 'Promises actually kept' },
        { key: 'blindEye', label: 'Blind Eye', hint: 'Blind calls that landed' },
        { key: 'coolHead', label: 'Cool Head', hint: 'Resistance to tilting after a bad round' },
    ];

    function renderBar(t, value) {
        const pct = Math.max(0, Math.min(100, Number(value)));
        return `
            <div class="pc-trait" title="${escape(t.hint)}">
                <span class="pc-trait-label">${escape(t.label)}</span>
                <span class="pc-trait-track">
                    <span class="pc-trait-fill" style="width:${pct}%"></span>
                </span>
                <span class="pc-trait-val">${pct}</span>
            </div>
        `;
    }

    // The tilt strip: two rates side by side. The GAP is the story — the
    // absolute rates are a lower bound (legacy rounds have no blind flag), but
    // both are depressed by the same bias so the gap stays honest.
    function renderTilt(p) {
        if (p.tiltIndex == null) return '';
        const heat = p.tiltIndex >= 45 ? 'hot' : p.tiltIndex >= 25 ? 'warm' : 'cool';
        const verdict = p.tiltIndex >= 45 ? 'Garam dimaag'
                      : p.tiltIndex >= 25 ? 'Thoda garam'
                      : 'Thanda dimaag';
        return `
            <div class="pc-tilt pc-tilt-${heat}">
                <span class="pc-tilt-label">Tilt</span>
                <span class="pc-tilt-bar">
                    <span class="pc-tilt-fill" style="width:${Math.min(100, p.tiltIndex)}%"></span>
                </span>
                <span class="pc-tilt-verdict">${escape(verdict)}</span>
            </div>
        `;
    }

    function renderCard(p) {
        const face = FACES[p.archetypeId] || '🃏';
        const bars = TRAITS
            .filter(t => p.traits && p.traits[t.key] != null)
            .map(t => renderBar(t, p.traits[t.key]))
            .join('');

        return `
            <li class="pc-card">
                <div class="pc-head">
                    <span class="pc-face" aria-hidden="true">${face}</span>
                    <div class="pc-id">
                        <span class="pc-team">${escape(p.team)}</span>
                        <span class="pc-arch" lang="hi-Latn">${escape(p.archetype)}</span>
                    </div>
                    <span class="pc-record">${escape(p.record)}</span>
                </div>
                <p class="pc-blurb" lang="hi-Latn">${escape(p.blurb)}</p>
                <div class="pc-traits">${bars}</div>
                ${renderTilt(p)}
                <p class="pc-evidence">${escape(p.evidence)}</p>
            </li>
        `;
    }

    // League-wide tilt headline — the finding that motivates the whole panel.
    function renderLeagueTilt(tilt) {
        if (!tilt || !tilt.league || !tilt.league.badSample) return '';
        const l = tilt.league;
        return `
            <p class="pc-league-tilt">
                After a bad round the table calls blind
                <strong>${l.afterBadPct}%</strong> of the time.
                After a good one, just <strong>${l.afterGoodPct}%</strong>.
                <span lang="hi-Latn">Ek round kharab, agla blind.</span>
            </p>
        `;
    }

    function mount(hostId = 'personalityCards') {
        const host = document.getElementById(hostId);
        if (!host) return;

        const d = digest();
        const people = d && Array.isArray(d.personalities) ? d.personalities : [];
        if (!people.length) { host.innerHTML = ''; return; }

        host.innerHTML = `
            <div class="stats-card personality-card">
                <div class="pc-card-head">
                    <h3>🎭 Table Personalities</h3>
                </div>
                <p class="card-hint">
                    Archetypes earned from real play — every label is backed by the number under it.
                </p>
                ${renderLeagueTilt(d.tilt)}
                <ul class="pc-grid">
                    ${people.map(renderCard).join('')}
                </ul>
            </div>
        `;
    }

    return { mount, digest, FACES, TRAITS };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonalityCards;
}
