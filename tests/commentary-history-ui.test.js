/**
 * The history drawer, at the seam between CommentaryLog and BroadcastStrip:
 * a round that is played must end up readable in the drawer's markup.
 */

// BroadcastStrip reaches for these as globals before falling back to require,
// so they have to exist before it is loaded.
global.StatsUtils = require('../js/utils/stats.js');
global.Narrate = require('../js/utils/narrate.js');
const CommentaryLog = require('../js/utils/commentaryLog.js');
global.CommentaryLog = CommentaryLog;

const BroadcastStrip = require('../js/components/broadcastStrip.js');

function fakeStorage() {
    const map = new Map();
    return {
        map,
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
    };
}

const TEAMS = [
    { id: 't1', name: 'Sky', members: ['A'] },
    { id: 't2', name: 'K2', members: ['B'] },
];

function matchWith(rounds, status = 'in_progress') {
    return {
        id: 'm-1',
        team1Id: 't1',
        team2Id: 't2',
        status,
        date: new Date('2026-08-15T10:00:00Z'),
        finalScore: {
            team1: rounds.reduce((s, r) => s + r.team1.score, 0),
            team2: rounds.reduce((s, r) => s + r.team2.score, 0),
        },
        rounds,
    };
}

const round = (n, s1, s2) => ({
    roundNumber: n,
    team1: { promise: 7, actual: 7, score: s1, blind: false },
    team2: { promise: 6, actual: 6, score: s2, blind: false },
});

describe('commentary history drawer', () => {
    beforeEach(() => {
        CommentaryLog._setStorage(fakeStorage());
        CommentaryLog.clear();
    });

    describe('logRound', () => {
        test('records the narration for a played round', () => {
            const match = matchWith([round(1, 70, -60)]);
            const entry = BroadcastStrip.logRound(match, TEAMS);

            expect(entry).not.toBeNull();
            expect(entry.kind).toBe('round');
            expect(entry.round).toBe(1);
            expect(entry.text).toBeTruthy();
            expect(CommentaryLog.entries('m-1')).toHaveLength(1);
        });

        test('accumulates one entry per round across a match', () => {
            const rounds = [];
            for (let i = 1; i <= 4; i++) {
                rounds.push(round(i, 70, -60));
                BroadcastStrip.logRound(matchWith(rounds.slice()), TEAMS);
            }

            const out = CommentaryLog.entries('m-1');
            expect(out).toHaveLength(4);
            expect(out.map(e => e.round)).toEqual([1, 2, 3, 4]);
        });

        test('re-logging the same round is a no-op (double submit / echo)', () => {
            const match = matchWith([round(1, 70, -60)]);
            BroadcastStrip.logRound(match, TEAMS);
            BroadcastStrip.logRound(match, TEAMS);

            expect(CommentaryLog.entries('m-1')).toHaveLength(1);
        });

        test('a completed match logs its last line as a result, not a round', () => {
            const match = matchWith([round(1, 500, -60)], 'completed');
            match.winnerId = 't1';
            const entry = BroadcastStrip.logRound(match, TEAMS);

            expect(entry.kind).toBe('result');
        });

        test('pending and cancelled matches log nothing', () => {
            expect(BroadcastStrip.logRound(matchWith([], 'pending'), TEAMS)).toBeNull();
            expect(BroadcastStrip.logRound(matchWith([], 'cancelled'), TEAMS)).toBeNull();
            expect(CommentaryLog.entries('m-1')).toHaveLength(0);
        });
    });

    describe('renderHistory', () => {
        test('renders nothing before anything has been said', () => {
            expect(BroadcastStrip.renderHistory(matchWith([round(1, 70, -60)]))).toBe('');
        });

        test('renders a scrollable panel once there is history', () => {
            const match = matchWith([round(1, 70, -60)]);
            BroadcastStrip.logRound(match, TEAMS);

            const html = BroadcastStrip.renderHistory(match);
            expect(html).toContain('ch-panel');
            expect(html).toContain('ch-list');
            expect(html).toContain('Commentary history');
        });

        test('starts collapsed', () => {
            const match = matchWith([round(1, 70, -60)]);
            BroadcastStrip.logRound(match, TEAMS);

            const html = BroadcastStrip.renderHistory(match);
            expect(html).toContain('aria-expanded="false"');
            expect(html).toContain('<div class="ch-panel" hidden>');
        });

        test('shows how many lines are in the drawer', () => {
            const rounds = [];
            for (let i = 1; i <= 3; i++) {
                rounds.push(round(i, 70, -60));
                BroadcastStrip.logRound(matchWith(rounds.slice()), TEAMS);
            }

            const html = BroadcastStrip.renderHistory(matchWith(rounds));
            expect(html).toContain('<span class="ch-count">3</span>');
        });

        test('every logged line appears in the markup', () => {
            CommentaryLog.append('m-1', { kind: 'spoken', round: 1, text: 'Blind called and landed.' });
            CommentaryLog.append('m-1', { kind: 'pundit', round: 2, text: 'K2 are in trouble.' });

            const html = BroadcastStrip.renderHistory(matchWith([round(1, 70, -60)]));
            expect(html).toContain('Blind called and landed.');
            expect(html).toContain('K2 are in trouble.');
        });

        test('labels spoken and AI lines distinctly so the reader can tell them apart', () => {
            CommentaryLog.append('m-1', { kind: 'spoken', round: 1, text: 'said out loud' });
            CommentaryLog.append('m-1', { kind: 'pundit', round: 1, text: 'written by ai' });

            const html = BroadcastStrip.renderHistory(matchWith([round(1, 70, -60)]));
            expect(html).toContain('ch-spoken');
            expect(html).toContain('ch-pundit');
            expect(html).toContain('SAID');
            expect(html).toContain('AI');
        });

        test('escapes text rather than injecting it as markup', () => {
            CommentaryLog.append('m-1', {
                kind: 'spoken', round: 1, text: '<img src=x onerror="alert(1)">',
            });

            const html = BroadcastStrip.renderHistory(matchWith([round(1, 70, -60)]));
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img');
        });
    });

    describe('render — the drawer rides along with the strip', () => {
        test('the strip includes the drawer once history exists', () => {
            const match = matchWith([round(1, 70, -60)]);
            BroadcastStrip.logRound(match, TEAMS);

            const html = BroadcastStrip.render(match, TEAMS);
            expect(html).toContain('broadcast-strip');
            expect(html).toContain('bs-history');
        });

        test('the strip renders as before when nothing has been said', () => {
            const html = BroadcastStrip.render(matchWith([round(1, 70, -60)]), TEAMS);
            expect(html).toContain('broadcast-strip');
            expect(html).not.toContain('bs-history');
        });
    });
});
