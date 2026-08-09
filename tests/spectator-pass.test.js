const SpectatorPass = require('../js/components/spectatorPass.js');
const { logic } = SpectatorPass;

describe('SpectatorPass.logic.parseQuery', () => {
    test('empty / undefined / no leading ? → {}', () => {
        expect(logic.parseQuery('')).toEqual({});
        expect(logic.parseQuery(undefined)).toEqual({});
        expect(logic.parseQuery(null)).toEqual({});
    });

    test('handles leading "?" and no leading "?"', () => {
        expect(logic.parseQuery('?tv=1')).toEqual({ tv: '1' });
        expect(logic.parseQuery('tv=1')).toEqual({ tv: '1' });
    });

    test('multi-param', () => {
        expect(logic.parseQuery('?tv=1&match=abc&debug=')).toEqual({
            tv: '1', match: 'abc', debug: '',
        });
    });

    test('decodes URI-encoded values', () => {
        expect(logic.parseQuery('?team=Team%20Alpha')).toEqual({ team: 'Team Alpha' });
    });

    test('ignores empty key segments from `&&`', () => {
        expect(logic.parseQuery('?tv=1&&match=abc')).toEqual({ tv: '1', match: 'abc' });
    });
});

describe('SpectatorPass.logic.initialEnabled', () => {
    test('?tv=1 forces on regardless of storage', () => {
        expect(logic.initialEnabled({ search: '?tv=1', storage: null })).toBe(true);
        expect(logic.initialEnabled({ search: '?tv=1', storage: '0' })).toBe(true);
    });

    test('?tv=0 forces off regardless of storage', () => {
        expect(logic.initialEnabled({ search: '?tv=0', storage: '1' })).toBe(false);
        expect(logic.initialEnabled({ search: '?tv=0', storage: null })).toBe(false);
    });

    test('no URL flag → storage wins', () => {
        expect(logic.initialEnabled({ search: '', storage: '1' })).toBe(true);
        expect(logic.initialEnabled({ search: '', storage: '0' })).toBe(false);
        expect(logic.initialEnabled({ search: '', storage: null })).toBe(false);
    });

    test('unrecognised tv value → falls through to storage', () => {
        // tv=foo is neither "1" nor "0" so logic falls through to storage.
        expect(logic.initialEnabled({ search: '?tv=foo', storage: '1' })).toBe(true);
        expect(logic.initialEnabled({ search: '?tv=foo', storage: null })).toBe(false);
    });

    test('handles missing args / defaults gracefully', () => {
        expect(logic.initialEnabled()).toBe(false);
        expect(logic.initialEnabled({})).toBe(false);
    });
});

describe('SpectatorPass.logic.toggle', () => {
    test('boolean flip', () => {
        expect(logic.toggle(false)).toBe(true);
        expect(logic.toggle(true)).toBe(false);
    });
});
