/**
 * Game Board — the inline round-entry experience that replaces the bare
 * promise/actual number inputs (§3.0).
 *
 * Layout per team panel:
 *   1. Header: team-color dot · team name · cumulative score
 *   2. Promise picker: 4-13 chips + BLIND chip (locks promise = 7)
 *   3. Actual picker: slider 0-13 with ± steppers (linked sum-to-13)
 *   4. Live score preview tinted by outcome
 *   5. "What if?" delta strip
 *
 * Contract with app.js: this component renders the SAME hidden form input
 * ids that submitRound() (app.js:1411-1418) reads:
 *   team{1,2}Promise${matchId}, team{1,2}Actual${matchId}, team{1,2}Blind${matchId}
 * So the existing submit path is untouched.
 */
const GameBoard = (() => {
    function escape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function chips(side, selectedPromise, blind) {
        const out = [];
        for (let v = 4; v <= 13; v++) {
            const cls = [
                'gb-chip',
                v === selectedPromise && !blind ? 'is-selected' : '',
                blind ? 'is-disabled' : '',
            ].filter(Boolean).join(' ');
            out.push(`<button type="button"
                class="${cls}"
                data-side="${side}"
                data-promise="${v}"
                ${blind ? 'disabled tabindex="-1"' : ''}
                aria-pressed="${v === selectedPromise && !blind}">${v}</button>`);
        }
        out.push(`<button type="button"
            class="gb-chip gb-chip-blind ${blind ? 'is-selected' : ''}"
            data-side="${side}"
            data-blind="1"
            aria-pressed="${blind}"
            title="Blind: promise locked at 7">🃏 BLIND</button>`);
        return out.join('');
    }

    function renderPanel({ matchId, side, teamName, cumulativeScore, color }) {
        // Sensible starting values: promise blank, actual 0/13 split lives on
        // the user's first interaction; we render 6 on both sides as a neutral
        // default (sums to 12 — the user is expected to nudge before commit).
        const initialPromise = '';
        const initialActual = side === 'team1' ? 7 : 6;
        return `
            <div class="gb-panel" data-side="${side}" style="--gb-accent: ${color};">
                <div class="gb-panel-head">
                    <span class="gb-dot" aria-hidden="true"></span>
                    <span class="gb-team-name">${escape(teamName)}</span>
                    <span class="gb-cumulative numeric">${cumulativeScore}</span>
                </div>

                <div class="gb-section">
                    <div class="gb-label">PROMISE</div>
                    <div class="gb-chip-grid" role="radiogroup" aria-label="${escape(teamName)} promise">
                        ${chips(side, null, false)}
                    </div>
                </div>

                <div class="gb-section">
                    <div class="gb-actual-head">
                        <span class="gb-label">ACTUAL</span>
                        <span class="gb-actual-value numeric" data-actual-value>${initialActual}</span>
                    </div>
                    <div class="gb-slider-row">
                        <button type="button" class="gb-stepper" data-step="-1" aria-label="Decrease actual">−</button>
                        <input
                            type="range"
                            class="gb-actual-slider"
                            min="0" max="13" step="1"
                            value="${initialActual}"
                            data-side="${side}"
                            aria-label="${escape(teamName)} actual hands"
                            aria-valuemin="0" aria-valuemax="13" aria-valuenow="${initialActual}"
                        />
                        <button type="button" class="gb-stepper" data-step="1" aria-label="Increase actual">+</button>
                    </div>
                    <div class="gb-slider-scale" aria-hidden="true">
                        <span>0</span><span>13</span>
                    </div>
                </div>

                <div class="gb-preview gb-preview-invalid" data-preview>
                    <div class="gb-preview-score numeric" data-preview-score>—</div>
                    <div class="gb-preview-label" data-preview-label>PICK A PROMISE</div>
                </div>

                <!-- Hidden form fields read by submitRound (app.js). Kept in sync
                     with the chip/slider state so the existing submit path works. -->
                <input type="hidden" id="${side}Promise${matchId}" value="${initialPromise}">
                <input type="hidden" id="${side}Actual${matchId}" value="${initialActual}">
                <input type="hidden" id="${side}Blind${matchId}" value="0">
                <input type="hidden" id="${side}Score${matchId}" value="0">
            </div>
        `;
    }

    function renderInline(match, team1, team2) {
        const matchId = match.id;
        const s1 = Number(match?.finalScore?.team1 || 0);
        const s2 = Number(match?.finalScore?.team2 || 0);
        const c1 = typeof StatsUtils !== 'undefined' ? StatsUtils.teamColor(team1.id) : 'var(--info)';
        const c2 = typeof StatsUtils !== 'undefined' ? StatsUtils.teamColor(team2.id) : 'var(--info)';
        const roundNumber = (match.currentRound || 0) + 1;

        return `
            <div class="game-board" data-match-id="${escape(matchId)}">
                <div class="gb-header">
                    <span class="gb-round-label">ROUND ${roundNumber}</span>
                    <span class="gb-vs">VS</span>
                </div>
                <form class="gb-form" onsubmit="submitRound(event, '${escape(matchId)}')">
                    <div class="gb-panels">
                        ${renderPanel({ matchId, side: 'team1', teamName: team1.name, cumulativeScore: s1, color: c1 })}
                        ${renderPanel({ matchId, side: 'team2', teamName: team2.name, cumulativeScore: s2, color: c2 })}
                    </div>
                    <div class="gb-whatif" data-whatif></div>
                    <div class="gb-actions">
                        <button type="submit" class="action-btn gb-commit" disabled>Commit round</button>
                        <button type="button" class="action-btn danger" onclick="cancelMatch('${escape(matchId)}')">Cancel match</button>
                    </div>
                </form>
            </div>
        `;
    }

    // ─── Event wiring ────────────────────────────────────────────────────────
    // Called after innerHTML lands so we can attach handlers and run the
    // initial preview computation. Idempotent — uses a data flag.
    function wire(matchId, root = document) {
        const board = root.querySelector(`.game-board[data-match-id="${CSS.escape(String(matchId))}"]`);
        if (!board || board.dataset.wired === '1') return;
        board.dataset.wired = '1';

        const state = {
            team1: { promise: null, actual: 7, blind: false },
            team2: { promise: null, actual: 6, blind: false },
        };

        // ─── Chip clicks (promise + blind) ───────────────────────────────
        board.querySelectorAll('.gb-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const side = chip.dataset.side;
                if (chip.dataset.blind === '1') {
                    // Toggle blind for this side.
                    const next = !state[side].blind;
                    state[side].blind = next;
                    if (next) {
                        state[side].promise = 7; // §4.4 lock
                    } else {
                        state[side].promise = null; // require explicit reselection
                    }
                } else {
                    const v = parseInt(chip.dataset.promise, 10);
                    if (state[side].blind) state[side].blind = false; // clearing blind by picking a number
                    state[side].promise = v;
                }
                redraw();
            });
        });

        // ─── Slider linkage (sum-to-13) ──────────────────────────────────
        const sliders = {
            team1: board.querySelector('.gb-actual-slider[data-side="team1"]'),
            team2: board.querySelector('.gb-actual-slider[data-side="team2"]'),
        };
        function setActual(side, value, { silent = false } = {}) {
            const clamped = Math.max(0, Math.min(13, Math.round(Number(value) || 0)));
            state[side].actual = clamped;
            // Link the opposite side so the pair always sums to 13.
            const other = side === 'team1' ? 'team2' : 'team1';
            state[other].actual = 13 - clamped;
            if (!silent) redraw();
        }
        sliders.team1.addEventListener('input', e => setActual('team1', e.target.value));
        sliders.team2.addEventListener('input', e => setActual('team2', e.target.value));

        // ─── Steppers ────────────────────────────────────────────────────
        board.querySelectorAll('.gb-stepper').forEach(btn => {
            btn.addEventListener('click', () => {
                const side = btn.closest('.gb-panel').dataset.side;
                const delta = parseInt(btn.dataset.step, 10) || 0;
                setActual(side, state[side].actual + delta);
            });
        });

        // ─── Re-render (chips selected, hidden inputs, preview, what-if) ─
        function redraw() {
            for (const side of ['team1', 'team2']) {
                const s = state[side];
                const panel = board.querySelector(`.gb-panel[data-side="${side}"]`);

                // Update chip selected/disabled state.
                panel.querySelectorAll('.gb-chip').forEach(chip => {
                    if (chip.dataset.blind === '1') {
                        chip.classList.toggle('is-selected', s.blind);
                        chip.setAttribute('aria-pressed', String(s.blind));
                    } else {
                        const v = parseInt(chip.dataset.promise, 10);
                        const active = !s.blind && v === s.promise;
                        chip.classList.toggle('is-selected', active);
                        chip.classList.toggle('is-disabled', s.blind);
                        chip.disabled = s.blind;
                        chip.setAttribute('aria-pressed', String(active));
                    }
                });

                // Sliders + readouts.
                const slider = sliders[side];
                slider.value = String(s.actual);
                slider.setAttribute('aria-valuenow', String(s.actual));
                panel.querySelector('[data-actual-value]').textContent = String(s.actual);

                // Hidden form fields → consumed by submitRound.
                document.getElementById(`${side}Promise${matchId}`).value = s.blind ? '7' : (s.promise == null ? '' : String(s.promise));
                document.getElementById(`${side}Actual${matchId}`).value = String(s.actual);
                document.getElementById(`${side}Blind${matchId}`).value = s.blind ? '1' : '0';

                // Live preview.
                renderPreview(panel, s);
            }
            renderWhatIf(board, state);
            updateCommitEnabled(board, state);
        }

        function renderPreview(panel, sideState) {
            const previewEl = panel.querySelector('[data-preview]');
            const scoreEl = panel.querySelector('[data-preview-score]');
            const labelEl = panel.querySelector('[data-preview-label]');
            const preview = (typeof Narrate !== 'undefined' && Narrate.previewScore)
                ? Narrate.previewScore(sideState.promise, sideState.actual, sideState.blind)
                : { score: 0, kind: 'invalid', label: 'PICK A PROMISE' };

            previewEl.classList.remove(
                'gb-preview-met', 'gb-preview-over', 'gb-preview-under',
                'gb-preview-blind-hit', 'gb-preview-blind-miss', 'gb-preview-invalid'
            );
            previewEl.classList.add(`gb-preview-${preview.kind}`);
            scoreEl.textContent = preview.kind === 'invalid'
                ? '—'
                : (preview.score > 0 ? `+${preview.score}` : String(preview.score));
            labelEl.textContent = preview.label;
            // Update hidden score input so any debug/legacy reader sees the right value.
            const hidden = document.getElementById(`${panel.dataset.side}Score${matchId}`);
            if (hidden) hidden.value = preview.kind === 'invalid' ? '0' : String(preview.score);
        }

        function renderWhatIf(board, state) {
            const out = board.querySelector('[data-whatif]');
            if (!out) return;
            const s1 = state.team1, s2 = state.team2;
            if (!Narrate?.previewScore) { out.textContent = ''; return; }
            const cur1 = Narrate.previewScore(s1.promise, s1.actual, s1.blind);
            const cur2 = Narrate.previewScore(s2.promise, s2.actual, s2.blind);
            if (cur1.kind === 'invalid' || cur2.kind === 'invalid') {
                out.innerHTML = '<span class="gb-whatif-dim">Pick a promise for both teams to see live scoring.</span>';
                return;
            }
            // Suggest the most informative single-step delta for the leader-by-score.
            const tip = (cur1.score >= cur2.score) ? deltaFor('team1', state) : deltaFor('team2', state);
            out.innerHTML = tip
                ? `<span class="gb-whatif-label">WHAT IF?</span> <span>${escape(tip)}</span>`
                : '';
        }

        function deltaFor(side, state) {
            const s = state[side];
            if (s.blind) return null;
            // Reasonable alternative: take 1 more (if room) or 1 fewer (if room).
            const tries = [];
            if (s.actual < 13) tries.push({ name: 'Take 1 more', actual: s.actual + 1 });
            if (s.actual > 0)  tries.push({ name: 'Take 1 fewer', actual: s.actual - 1 });
            const teamLabel = side === 'team1' ? 'Team 1' : 'Team 2';
            for (const t of tries) {
                const p = Narrate.previewScore(s.promise, t.actual, false);
                if (p.kind === 'invalid') continue;
                return `${teamLabel} · ${t.name} → ${p.score > 0 ? '+' : ''}${p.score} (${p.label.toLowerCase()})`;
            }
            return null;
        }

        function updateCommitEnabled(board, state) {
            const valid = ['team1', 'team2'].every(side => {
                const s = state[side];
                if (s.blind) return s.actual >= 0 && s.actual <= 13;
                return s.promise != null && s.actual >= 0 && s.actual <= 13;
            });
            const sumOk = (state.team1.actual + state.team2.actual) === 13;
            const btn = board.querySelector('.gb-commit');
            if (btn) btn.disabled = !(valid && sumOk);
        }

        // Initial render — populate everything from default state.
        redraw();
    }

    return { renderInline, wire };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameBoard;
}
