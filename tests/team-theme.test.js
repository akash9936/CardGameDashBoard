const StatsUtils = require('../js/utils/stats.js');

describe('StatsUtils.ICON_SET / PATTERN_SET', () => {
    test('icon set has 24 entries with unique keys + glyphs', () => {
        expect(StatsUtils.ICON_SET).toHaveLength(24);
        const keys = StatsUtils.ICON_SET.map(i => i.key);
        const glyphs = StatsUtils.ICON_SET.map(i => i.glyph);
        expect(new Set(keys).size).toBe(24);
        expect(new Set(glyphs).size).toBe(24);
    });

    test('pattern set covers dot/stripe/chevron/hatch families', () => {
        const keys = StatsUtils.PATTERN_SET.map(p => p.key);
        for (const expected of ['dot', 'stripe-up', 'stripe-h', 'stripe-down', 'chevron', 'hatch']) {
            expect(keys).toContain(expected);
        }
    });
});

describe('StatsUtils.teamIcon', () => {
    test('deterministic when no override (same id → same icon)', () => {
        const a1 = StatsUtils.teamIcon('alpha');
        const a2 = StatsUtils.teamIcon('alpha');
        expect(a1.key).toBe(a2.key);
        expect(a1.glyph).toBe(a2.glyph);
    });

    test('accepts a bare id or a team object', () => {
        const fromId = StatsUtils.teamIcon('alpha');
        const fromObj = StatsUtils.teamIcon({ id: 'alpha' });
        expect(fromId.key).toBe(fromObj.key);
    });

    test('team.theme.iconKey override wins', () => {
        const team = { id: 'alpha', theme: { iconKey: 'crown' } };
        expect(StatsUtils.teamIcon(team).key).toBe('crown');
        expect(StatsUtils.teamIcon(team).glyph).toBe('♛');
    });

    test('unknown override key falls back to deterministic default', () => {
        const team = { id: 'alpha', theme: { iconKey: 'not-a-real-icon' } };
        const fallback = StatsUtils.teamIcon({ id: 'alpha' });
        expect(StatsUtils.teamIcon(team).key).toBe(fallback.key);
    });
});

describe('StatsUtils.teamPattern', () => {
    test('deterministic when no override', () => {
        expect(StatsUtils.teamPattern('alpha').key)
            .toBe(StatsUtils.teamPattern('alpha').key);
    });

    test('team.theme.patternKey override wins', () => {
        const team = { id: 'alpha', theme: { patternKey: 'chevron' } };
        expect(StatsUtils.teamPattern(team).key).toBe('chevron');
    });

    test('unknown pattern key falls back', () => {
        const team = { id: 'alpha', theme: { patternKey: 'zigzag' } };
        const fallback = StatsUtils.teamPattern({ id: 'alpha' });
        expect(StatsUtils.teamPattern(team).key).toBe(fallback.key);
    });

    test('icon override does not affect pattern (orthogonal axes)', () => {
        const team = { id: 'alpha', theme: { iconKey: 'crown' } };
        expect(StatsUtils.teamPattern(team).key)
            .toBe(StatsUtils.teamPattern({ id: 'alpha' }).key);
    });
});
