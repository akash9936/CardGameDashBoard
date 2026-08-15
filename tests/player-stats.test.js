const PlayerStats = require('../js/utils/playerStats.js');

const TEAMS = [
    { id: 't1', name: 'Gaurav/Akash' },
    { id: 't2', name: 'KorbaGang' },
    { id: 't3', name: 'Sky/K2' },
    { id: 't4', name: 'Propellers' },
    { id: 't5', name: 'Mystery' },
];

// A test roster, passed explicitly so these tests never depend on whatever
// js/data/rosters.js happens to contain — that file is user-edited data.
const ROSTERS = {
    'Gaurav/Akash': ['Gaurav', 'Akash'],
    'KorbaGang': ['Ravi', 'Anish'],
    'Sky/K2': ['Akash', 'k2'],
    'Propellers': ['Shreyans', 'Akash'],
    'Mystery': ['?', '?'],
};
const ALIASES = { k2: 'Kritagya', sky: 'Akash' };
const OPTS = { rosters: ROSTERS, aliases: ALIASES };

let seq = 0;
function match(date, t1, t2, winner) {
    seq++;
    return {
        id: `m${seq}`, date, team1Id: t1, team2Id: t2,
        status: 'completed', winnerId: winner,
        rounds: [], finalScore: { team1: 500, team2: 300 },
    };
}
beforeEach(() => { seq = 0; });

describe('PlayerStats.identify', () => {
    test('resolves a team name to its people', () => {
        expect(PlayerStats.identify('Gaurav/Akash', OPTS)).toEqual(['Gaurav', 'Akash']);
    });

    test('matches case-insensitively and trims', () => {
        expect(PlayerStats.identify('  gaurav/akash  ', OPTS)).toEqual(['Gaurav', 'Akash']);
    });

    test('applies aliases so one person has one identity', () => {
        expect(PlayerStats.identify('Sky/K2', OPTS)).toEqual(['Akash', 'Kritagya']);
    });

    test('drops placeholders rather than naming them', () => {
        expect(PlayerStats.identify('Mystery', OPTS)).toEqual([]);
    });

    test('an unknown team has no players', () => {
        expect(PlayerStats.identify('Nobody', OPTS)).toEqual([]);
        expect(PlayerStats.identify('', OPTS)).toEqual([]);
        expect(PlayerStats.identify(null, OPTS)).toEqual([]);
    });
});

describe('PlayerStats.careerOf', () => {
    test('is null for someone who never played', () => {
        expect(PlayerStats.careerOf('Nobody', [], TEAMS, OPTS)).toBeNull();
    });

    test('follows a person across different team names', () => {
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't1'),   // Akash w/ Gaurav, won
            match('2026-04-11T22:00:00Z', 't3', 't2', 't2'),   // Akash w/ Kritagya, lost
            match('2026-04-12T22:00:00Z', 't4', 't2', 't2'),   // Akash w/ Shreyans, lost
        ];
        const c = PlayerStats.careerOf('Akash', ms, TEAMS, OPTS);
        expect(c.matches).toBe(3);
        expect(c.wins).toBe(1);
        expect(c.losses).toBe(2);
        expect(c.teamsPlayedFor).toEqual(['Gaurav/Akash', 'Propellers', 'Sky/K2']);
    });

    test('counts distinct partners and partners-in-losses separately', () => {
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't2'),   // lost w/ Gaurav
            match('2026-04-11T22:00:00Z', 't3', 't2', 't2'),   // lost w/ Kritagya
            match('2026-04-12T22:00:00Z', 't4', 't2', 't4'),   // WON w/ Shreyans
        ];
        const c = PlayerStats.careerOf('Akash', ms, TEAMS, OPTS);
        expect(c.distinctPartners).toBe(3);
        expect(c.partnersInLosses).toBe(2);
    });

    test('ignores incomplete matches', () => {
        const ms = [match('2026-04-10T22:00:00Z', 't1', 't2', 't1')];
        ms.push(Object.assign(match('2026-04-11T22:00:00Z', 't1', 't2', null), {
            status: 'in_progress',
        }));
        expect(PlayerStats.careerOf('Akash', ms, TEAMS, OPTS).matches).toBe(1);
    });

    test('best and worst partner need a minimum sample', () => {
        // One match with each partner is not a verdict on a partnership.
        const ms = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't1'),
            match('2026-04-11T22:00:00Z', 't3', 't2', 't2'),
        ];
        const c = PlayerStats.careerOf('Akash', ms, TEAMS, OPTS);
        expect(c.bestPartner).toBeNull();
    });

    test('names a best partner once the sample is deep enough', () => {
        const ms = [];
        for (let i = 0; i < 3; i++) ms.push(match(`2026-04-1${i}T22:00:00Z`, 't1', 't2', 't1'));
        for (let i = 0; i < 3; i++) ms.push(match(`2026-04-2${i}T22:00:00Z`, 't3', 't2', 't2'));
        const c = PlayerStats.careerOf('Akash', ms, TEAMS, OPTS);
        expect(c.bestPartner.name).toBe('Gaurav');
        expect(c.worstPartner.name).toBe('Kritagya');
    });
});

describe('PlayerStats.nuggets', () => {
    test('says nothing when the roster does not know the teams', () => {
        const m = match('2026-04-10T22:00:00Z', 't5', 't5', 't5');
        expect(PlayerStats.nuggets(m, [m], TEAMS, OPTS)).toEqual([]);
    });

    test('reports losing with several different partners', () => {
        const history = [
            match('2026-04-10T22:00:00Z', 't1', 't2', 't2'),
            match('2026-04-11T22:00:00Z', 't3', 't2', 't2'),
            match('2026-04-12T22:00:00Z', 't4', 't2', 't2'),
        ];
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't2');
        const out = PlayerStats.nuggets(current, history.concat([current]), TEAMS, OPTS);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatch(/Akash has now lost with 3 different partners\./);
    });

    test('never emits more than one person-level line', () => {
        const history = [];
        for (let i = 0; i < 4; i++) {
            history.push(match(`2026-04-1${i}T22:00:00Z`, 't1', 't2', 't2'));
            history.push(match(`2026-04-2${i}T22:00:00Z`, 't3', 't2', 't2'));
            history.push(match(`2026-04-0${i}T22:00:00Z`, 't4', 't2', 't2'));
        }
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't2');
        const out = PlayerStats.nuggets(current, history.concat([current]), TEAMS, OPTS);
        expect(out.length).toBeLessThanOrEqual(1);
    });

    test('excludes the current match from the career it describes', () => {
        const current = match('2026-05-01T22:00:00Z', 't1', 't2', 't2');
        expect(PlayerStats.nuggets(current, [current], TEAMS, OPTS)).toEqual([]);
    });
});

describe('PlayerStats roster safety', () => {
    test('the shipped roster file loads and contains no unresolved placeholder', () => {
        // rosters.js is user-edited; a '?' left in place must stay harmless
        // rather than reaching a line as a player called "?".
        const { ROSTERS: shipped } = require('../js/data/rosters.js');
        for (const [team, members] of Object.entries(shipped)) {
            const resolved = PlayerStats.identify(team);
            expect(resolved.every(p => !PlayerStats.isPlaceholder(p))).toBe(true);
            expect(resolved.length).toBeLessThanOrEqual(members.length);
        }
    });
});
