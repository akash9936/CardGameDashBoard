/**
 * Animation primitives — count-up and confetti.
 * All animations respect prefers-reduced-motion.
 *
 * See claude/ui-stats-improvements.md §2.5 (motion tokens), §3.1 (reveal),
 * §3.3 (winner moment).
 */
const Animate = (() => {
    function prefersReducedMotion() {
        return typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    }

    // ease-out-expo, matches --ease-out-expo token (§2.5)
    function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    /**
     * Animate an element's text content from `from` to `to` over `duration` ms.
     * Number is rendered with `formatter(value)`; defaults to a signed integer.
     * Returns a Promise that resolves when the animation completes.
     */
    function countUp(el, from, to, duration = 700, formatter = defaultFormat) {
        return new Promise(resolve => {
            if (!el) { resolve(); return; }
            const f = Number(from) || 0;
            const t = Number(to) || 0;

            if (prefersReducedMotion() || duration <= 0 || f === t) {
                el.textContent = formatter(t);
                resolve();
                return;
            }

            const start = performance.now();
            const delta = t - f;

            function frame(now) {
                const elapsed = now - start;
                const progress = Math.min(1, elapsed / duration);
                const eased = easeOutExpo(progress);
                const value = f + delta * eased;
                el.textContent = formatter(value);
                if (progress < 1) {
                    requestAnimationFrame(frame);
                } else {
                    el.textContent = formatter(t);
                    resolve();
                }
            }
            requestAnimationFrame(frame);
        });
    }

    function defaultFormat(v) {
        const rounded = Math.round(v);
        return rounded > 0 ? `+${rounded}` : String(rounded);
    }

    /**
     * Fire a confetti burst. Suppressed under prefers-reduced-motion.
     * `opts` is passed straight through to canvas-confetti (CDN global).
     *
     * Recommended defaults per §3.1: { particleCount: 80, spread: 60, gravity: 1 }
     */
    function burstConfetti(opts = {}) {
        if (prefersReducedMotion()) return;
        if (typeof window === 'undefined' || typeof window.confetti !== 'function') return;
        window.confetti({
            particleCount: 80,
            spread: 60,
            startVelocity: 45,
            decay: 0.9,
            gravity: 1,
            ticks: 200,
            ...opts,
        });
    }

    /**
     * Winner-moment double burst (§3.3): two side-bursts in team colors.
     * Total visible duration ~2200 ms.
     */
    function winnerConfetti(colors) {
        if (prefersReducedMotion()) return;
        const palette = (Array.isArray(colors) && colors.length) ? colors : ['#F2C84A', '#7E8BF0'];
        burstConfetti({ particleCount: 100, spread: 70, origin: { x: 0.2, y: 0.6 }, colors: palette });
        setTimeout(() => {
            burstConfetti({ particleCount: 100, spread: 70, origin: { x: 0.8, y: 0.6 }, colors: palette });
        }, 250);
    }

    return { countUp, burstConfetti, winnerConfetti, prefersReducedMotion };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Animate;
}
