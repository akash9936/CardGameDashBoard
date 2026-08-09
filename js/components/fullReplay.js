/**
 * §7.1 Full Match Replay — the completionist sibling of §4.0 Moment Replay.
 *
 * `FullReplay.open(match, teams)` mounts a glass overlay that animates the
 * match round-by-round. 700 ms per round by default. The worm chart redraws
 * each tick with one more data point; the scoreboard numerals count up; a
 * one-line narration describes what just happened. Pure animation — no
 * Firestore reads, no aggregations, no model writes.
 *
 * Keyboard: Space toggles play/pause, ←/→ steps one round, 1-9 jumps to that
 * round, Home/End jump to start/end, Esc closes. While the overlay is open
 * any other keys are ignored.
 *
 * Pure-function logic is on `FullReplay.logic` so the clamp / next / prev /
 * jumpTo arithmetic can be unit-tested without a DOM.
 */
const FullReplay = (() => {
    const DEFAULT_TICK_MS = 700;

    // ─── Pure logic (testable without DOM) ──────────────────────────────────
    const logic = {
        clamp(i, total) {
            // Index domain is [0, total]. 0 means "before any round";
            // `total` means "after the last round". This matches the worm
            // chart which always starts at Start = 0.
            if (!Number.isFinite(i)) return 0;
            if (i < 0) return 0;
            if (i > total) return total;
            return i;
        },
        next(i, total) { return logic.clamp(i + 1, total); },
        prev(i, total) { return logic.clamp(i - 1, total); },
        jumpTo(roundNumber, total) {
            // 1-based round numbers; jump to round N means show first N points.
            return logic.clamp(roundNumber, total);
        },
        // Build cumulative arrays prefix-summed up to `index` (exclusive of
        // the full series past that point).
        seriesUpTo(series, index) {
            const i = logic.clamp(index, (series.labels || []).length - 1);
            return {
                labels: series.labels.slice(0, i + 1),
                team1: series.team1.slice(0, i + 1),
                team2: series.team2.slice(0, i + 1),
            };
        },
    };

    // ─── DOM state ───────────────────────────────────────────────────────────
    let _overlay = null;
    let _chart = null;
    let _interval = null;
    let _index = 0;
    let _match = null;
    let _teams = [];
    let _series = null;
    let _playing = false;
    let _onKey = null;

    function open(match, teams) {
        if (!match || match.status !== 'completed') return;
        const rounds = Array.isArray(match.rounds) ? match.rounds : [];
        if (!rounds.length) return;

        _match = match;
        _teams = teams || [];
        _series = StatsUtils.cumulativeSeries(match);
        _index = 0;
        _playing = false;

        mountOverlay();
        renderFrame();
        setPlaying(true); // kick off
    }

    function close() {
        stopTicker();
        if (_onKey) {
            document.removeEventListener('keydown', _onKey, true);
            _onKey = null;
        }
        if (_chart) { _chart.destroy(); _chart = null; }
        if (_overlay) { _overlay.remove(); _overlay = null; }
    }

    function totalIndex() {
        return (_series?.labels?.length || 1) - 1;
    }

    function mountOverlay() {
        if (_overlay) _overlay.remove();
        const total = totalIndex();
        const t1 = _teams.find(t => String(t.id) === String(_match.team1Id));
        const t2 = _teams.find(t => String(t.id) === String(_match.team2Id));
        const c1 = StatsUtils.teamColor(_match.team1Id);
        const c2 = StatsUtils.teamColor(_match.team2Id);

        const dots = Array.from({ length: total }, (_, i) =>
            `<button class="fr-dot" data-round="${i + 1}" aria-label="Jump to round ${i + 1}"></button>`
        ).join('');

        const overlay = document.createElement('div');
        overlay.className = 'fr-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Full match replay');
        overlay.innerHTML = `
            <div class="fr-card">
                <button type="button" class="fr-close" aria-label="Close replay">✕</button>

                <div class="fr-header">
                    <div class="fr-team fr-team-1" style="--fr-color:${c1}">
                        <div class="fr-team-name">${escapeHtmlLocal(t1?.name || 'Team 1')}</div>
                        <div class="fr-score numeric" id="frScore1" data-target="0">0</div>
                    </div>
                    <div class="fr-vs">
                        <div class="fr-round-label" id="frRoundLabel">Start</div>
                        <div class="fr-progress" id="frProgress">${dots}</div>
                    </div>
                    <div class="fr-team fr-team-2" style="--fr-color:${c2}">
                        <div class="fr-team-name">${escapeHtmlLocal(t2?.name || 'Team 2')}</div>
                        <div class="fr-score numeric" id="frScore2" data-target="0">0</div>
                    </div>
                </div>

                <div class="fr-chart-wrap">
                    <canvas id="frWorm"></canvas>
                </div>

                <div class="fr-narration" id="frNarration">Press space to pause. Use ← → to step, 1–9 to jump, Esc to exit.</div>

                <div class="fr-controls">
                    <button type="button" class="fr-btn" data-act="rewind" aria-label="Rewind">⏮</button>
                    <button type="button" class="fr-btn" data-act="prev"   aria-label="Previous round">←</button>
                    <button type="button" class="fr-btn fr-play" data-act="play" aria-label="Play / pause">▶</button>
                    <button type="button" class="fr-btn" data-act="next"   aria-label="Next round">→</button>
                    <button type="button" class="fr-btn" data-act="end"    aria-label="Skip to end">⏭</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        _overlay = overlay;

        overlay.querySelector('.fr-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', () => act(btn.dataset.act));
        });
        overlay.querySelectorAll('.fr-dot').forEach(d => {
            d.addEventListener('click', () => jumpTo(Number(d.dataset.round)));
        });

        // Keyboard. Capture-phase so we get keys before any background nav.
        _onKey = (e) => {
            const tag = (e.target?.tagName || '').toLowerCase();
            if (['input', 'textarea', 'select'].includes(tag)) return;
            if (e.target?.isContentEditable) return;

            switch (e.key) {
                case 'Escape':    e.preventDefault(); close(); break;
                case ' ':         e.preventDefault(); setPlaying(!_playing); break;
                case 'ArrowRight':
                case 'l':         e.preventDefault(); step(+1); break;
                case 'ArrowLeft':
                case 'h':         e.preventDefault(); step(-1); break;
                case 'Home':      e.preventDefault(); jumpTo(0); break;
                case 'End':       e.preventDefault(); jumpTo(totalIndex()); break;
                default:
                    if (/^[1-9]$/.test(e.key)) {
                        e.preventDefault();
                        jumpTo(Number(e.key));
                    }
            }
        };
        document.addEventListener('keydown', _onKey, true);

        mountChart(c1, c2, t1?.name || 'Team 1', t2?.name || 'Team 2');
    }

    function mountChart(c1, c2, n1, n2) {
        if (typeof Chart === 'undefined') return;
        const canvas = document.getElementById('frWorm');
        if (!canvas) return;
        const css = getComputedStyle(document.documentElement);
        const muted = css.getPropertyValue('--text-muted').trim() || '#94a3b8';

        const winLinePlugin = {
            id: 'winLine',
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                if (!scales.y) return;
                const yMax = scales.y.max ?? 500;
                if (yMax < 500) return;
                const y = scales.y.getPixelForValue(500);
                if (y < chartArea.top || y > chartArea.bottom) return;
                ctx.save();
                ctx.strokeStyle = '#fbbf24';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#fbbf24';
                ctx.font = '600 12px -apple-system, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText('Win @ 500', chartArea.right - 6, y - 4);
                ctx.restore();
            },
        };

        _chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: [_series.labels[0]],
                datasets: [
                    { label: n1, data: [_series.team1[0]], borderColor: c1, backgroundColor: c1 + '22', tension: 0.25, fill: false, pointRadius: 3 },
                    { label: n2, data: [_series.team2[0]], borderColor: c2, backgroundColor: c2 + '22', tension: 0.25, fill: false, pointRadius: 3 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                plugins: { legend: { labels: { color: muted } } },
                scales: {
                    x: { ticks: { color: muted }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y: {
                        ticks: { color: muted },
                        grid: { color: 'rgba(148,163,184,0.1)' },
                        suggestedMin: 0,
                        suggestedMax: 550,
                    },
                },
            },
            plugins: [winLinePlugin],
        });
    }

    function setPlaying(p) {
        _playing = !!p;
        const btn = _overlay?.querySelector('.fr-play');
        if (btn) btn.textContent = _playing ? '⏸' : '▶';
        if (_playing) startTicker(); else stopTicker();
    }

    function startTicker() {
        stopTicker();
        _interval = setInterval(() => {
            if (_index >= totalIndex()) { setPlaying(false); return; }
            step(+1);
        }, DEFAULT_TICK_MS);
    }
    function stopTicker() {
        if (_interval) { clearInterval(_interval); _interval = null; }
    }

    function step(delta) {
        const total = totalIndex();
        const next = delta > 0 ? logic.next(_index, total) : logic.prev(_index, total);
        if (next === _index) {
            if (delta > 0) setPlaying(false);
            return;
        }
        _index = next;
        renderFrame();
    }

    function jumpTo(idx) {
        const total = totalIndex();
        _index = logic.clamp(idx, total);
        // Reset chart data when scrubbing backward so the worm matches state.
        if (_chart) {
            _chart.data.labels = _series.labels.slice(0, _index + 1);
            _chart.data.datasets[0].data = _series.team1.slice(0, _index + 1);
            _chart.data.datasets[1].data = _series.team2.slice(0, _index + 1);
            _chart.update('none');
        }
        renderFrame({ skipChart: true });
    }

    function renderFrame(opts = {}) {
        const i = _index;
        const labels = _series.labels;
        const t1 = _series.team1[i];
        const t2 = _series.team2[i];

        const score1El = _overlay?.querySelector('#frScore1');
        const score2El = _overlay?.querySelector('#frScore2');
        const labelEl  = _overlay?.querySelector('#frRoundLabel');
        const narrEl   = _overlay?.querySelector('#frNarration');

        if (score1El) animateCount(score1El, Number(score1El.dataset.target || 0), t1);
        if (score2El) animateCount(score2El, Number(score2El.dataset.target || 0), t2);
        if (score1El) score1El.dataset.target = String(t1);
        if (score2El) score2El.dataset.target = String(t2);

        if (labelEl) labelEl.textContent = labels[i] || 'Start';
        if (narrEl)  narrEl.innerHTML = narrationFor(i);

        // Progress dots
        const dots = _overlay?.querySelectorAll('.fr-dot');
        if (dots) {
            dots.forEach((d, idx) => {
                d.classList.toggle('is-past',  idx + 1 < i);
                d.classList.toggle('is-active', idx + 1 === i);
            });
        }

        // Append the latest point to the chart unless we just scrubbed.
        if (_chart && !opts.skipChart) {
            _chart.data.labels = labels.slice(0, i + 1);
            _chart.data.datasets[0].data = _series.team1.slice(0, i + 1);
            _chart.data.datasets[1].data = _series.team2.slice(0, i + 1);
            _chart.update();
        }
    }

    // Per-round inline narration. Reads the round directly (no Narrate
    // dependency — Narrate's API is whole-match summary, not per-round).
    function narrationFor(i) {
        if (i === 0) return 'Tip-off — both teams at 0.';
        const round = _match.rounds.find(r => Number(r.roundNumber) === i)
                    || _match.rounds[i - 1];
        if (!round) return '';
        const t1 = _teams.find(t => String(t.id) === String(_match.team1Id));
        const t2 = _teams.find(t => String(t.id) === String(_match.team2Id));
        const s1 = Number(round.team1?.score || 0);
        const s2 = Number(round.team2?.score || 0);
        const c1 = StatsUtils.teamColor(_match.team1Id);
        const c2 = StatsUtils.teamColor(_match.team2Id);

        const part = (side, team, color, score) => {
            if (StatsUtils.isBlindSide(side)) {
                return score > 0
                    ? `<strong style="color:${color}">${escapeHtmlLocal(team?.name || '')}</strong> nailed a blind for +140`
                    : `<strong style="color:${color}">${escapeHtmlLocal(team?.name || '')}</strong> missed blind for −70`;
            }
            const promise = Number(side?.promise || 0);
            const actual  = Number(side?.actual  || 0);
            if (promise > 0 && actual >= promise * 2) {
                return `<strong style="color:${color}">${escapeHtmlLocal(team?.name || '')}</strong> over-extended (P${promise} / A${actual}) for ${score}`;
            }
            if (promise > 0 && actual < promise) {
                return `<strong style="color:${color}">${escapeHtmlLocal(team?.name || '')}</strong> missed promise (P${promise} / A${actual}) for ${score}`;
            }
            return `<strong style="color:${color}">${escapeHtmlLocal(team?.name || '')}</strong> ${score >= 0 ? '+' : ''}${score} (P${promise} / A${actual})`;
        };

        const left  = part(round.team1, t1, c1, s1);
        const right = part(round.team2, t2, c2, s2);
        return `R${i} — ${left}; ${right}.`;
    }

    function animateCount(el, from, to) {
        if (from === to) { el.textContent = String(to); return; }
        const reduce = matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (reduce) { el.textContent = String(to); return; }
        const start = performance.now();
        const dur = 300;
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        function tick(now) {
            const t = Math.min(1, (now - start) / dur);
            const v = Math.round(from + (to - from) * ease(t));
            el.textContent = String(v);
            if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function act(name) {
        switch (name) {
            case 'play':   setPlaying(!_playing); break;
            case 'prev':   step(-1); setPlaying(false); break;
            case 'next':   step(+1); setPlaying(false); break;
            case 'rewind': jumpTo(0); setPlaying(false); break;
            case 'end':    jumpTo(totalIndex()); setPlaying(false); break;
        }
    }

    function escapeHtmlLocal(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return { open, close, logic };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FullReplay;
}
