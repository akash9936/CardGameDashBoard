// Unit Tests for Scoring System — Section 4 of CLAUDE.md (locked rules)
//
// Cases (priority order, CLAUDE.md §4.6):
//   1. Blind selected → §4.4  (success ≥7 → +140; failure <7 → -70)
//   2. Actual < Promise → §4.1  (under-promise → -(promise × 10))
//   3. Actual ≥ Promise × 2 → §4.3  (over-extension → -(promise × 10))
//   4. Promise ≤ Actual < Promise × 2 → §4.2  ((promise × 10) + (actual − promise))

const path = require('path');

global.DateUtils = {
    safeDate: (date) => (date ? new Date(date) : new Date())
};

const Match = require(path.resolve(__dirname, '../js/models/Match.js'));
const MatchService = require(path.resolve(__dirname, '../js/services/matchService.js'));
global.Match = Match;
global.MatchService = MatchService;

// Mock Firebase service for testing
class MockFirebaseService {
    constructor() {
        this.teams = [];
        this.matches = [];
    }
    async getAllTeams() { return [...this.teams]; }
    async getTeam(id) { return this.teams.find(t => t.id === id); }
    async createTeam(data) {
        const id = `${Date.now()}-${Math.random()}`;
        const team = { id, ...data };
        this.teams.push(team);
        return team;
    }
    async getAllMatches() { return [...this.matches]; }
    async getMatch(id) { return this.matches.find(m => m.id === id); }
    async createMatch(data) {
        const id = Date.now().toString() + Math.random();
        const match = { id, ...data };
        this.matches.push(match);
        return id;
    }
    async updateMatch(id, updates) {
        const i = this.matches.findIndex(m => m.id === id);
        if (i === -1) throw new Error('Match not found');
        this.matches[i] = { ...this.matches[i], ...updates };
        return this.matches[i];
    }
    async updateTeam() { /* no-op for scoring tests */ }
    reset() { this.teams = []; this.matches = []; }
}

function createMatchService() {
    const mockDb = new MockFirebaseService();
    return { service: new MatchService(mockDb), mockDb };
}

async function createTestTeams(mockDb) {
    const baseStats = {
        totalScore: 0, wins: 0, losses: 0, draws: 0, matchesPlayed: 0,
        roundsWon: 0, roundsLost: 0, points: 0
    };
    const team1 = await mockDb.createTeam({ name: 'Alpha', members: ['A'], stats: { ...baseStats }, matchHistory: [] });
    const team2 = await mockDb.createTeam({ name: 'Beta', members: ['B'], stats: { ...baseStats }, matchHistory: [] });
    return { team1, team2 };
}

describe('Scoring System — CLAUDE.md §4 (locked rules)', () => {
    describe('§4.1 Under-promise: Actual < Promise → -(promise × 10)', () => {
        test('Promise 4, Actual 3 → -40', () => {
            expect(Match.computeScore(4, 3)).toBe(-40);
        });
        test('Promise 8, Actual 5 → -80', () => {
            expect(Match.computeScore(8, 5)).toBe(-80);
        });
        test('Promise 10, Actual 0 → -100', () => {
            expect(Match.computeScore(10, 0)).toBe(-100);
        });
        test('Promise 13, Actual 12 → -130', () => {
            expect(Match.computeScore(13, 12)).toBe(-130);
        });
    });

    describe('§4.2 Met with extras: Promise ≤ Actual < Promise×2 → (promise × 10) + (actual − promise)', () => {
        test('Promise 8, Actual 8 (a=0) → 80', () => {
            expect(Match.computeScore(8, 8)).toBe(80);
        });
        test('Promise 8, Actual 10 (a=2) → 82', () => {
            expect(Match.computeScore(8, 10)).toBe(82);
        });
        test('Promise 4, Actual 7 (a=3) → 43', () => {
            expect(Match.computeScore(4, 7)).toBe(43);
        });
        test('Promise 5, Actual 9 (a=4, 9 < 10) → 54', () => {
            expect(Match.computeScore(5, 9)).toBe(54);
        });
        test('Promise 6, Actual 11 (11 < 12) → 65', () => {
            expect(Match.computeScore(6, 11)).toBe(65);
        });
        test('Promise 13, Actual 13 (no double possible) → 130', () => {
            expect(Match.computeScore(13, 13)).toBe(130);
        });
    });

    describe('§4.3 Over-extension: Actual ≥ Promise × 2 → -(promise × 10)', () => {
        test('Promise 4, Actual 8 (boundary 4×2) → -40', () => {
            expect(Match.computeScore(4, 8)).toBe(-40);
        });
        test('Promise 4, Actual 9 → -40', () => {
            expect(Match.computeScore(4, 9)).toBe(-40);
        });
        test('Promise 4, Actual 13 → -40', () => {
            expect(Match.computeScore(4, 13)).toBe(-40);
        });
        test('Promise 5, Actual 10 (boundary 5×2) → -50', () => {
            expect(Match.computeScore(5, 10)).toBe(-50);
        });
        test('Promise 6, Actual 12 (boundary 6×2) → -60', () => {
            expect(Match.computeScore(6, 12)).toBe(-60);
        });
    });

    describe('§4.4 Blind: promise fixed at 7, no extras bonus', () => {
        test('Blind, Actual 7 → +140', () => {
            expect(Match.computeScore(7, 7, { blind: true })).toBe(140);
        });
        test('Blind, Actual 11 → +140 (extras do not add)', () => {
            expect(Match.computeScore(7, 11, { blind: true })).toBe(140);
        });
        test('Blind, Actual 13 → +140 (over-extension does not apply)', () => {
            expect(Match.computeScore(7, 13, { blind: true })).toBe(140);
        });
        test('Blind, Actual 6 → -70', () => {
            expect(Match.computeScore(7, 6, { blind: true })).toBe(-70);
        });
        test('Blind, Actual 0 → -70', () => {
            expect(Match.computeScore(7, 0, { blind: true })).toBe(-70);
        });
    });

    describe('§4.6 Case priority — over-extension wins at the boundary', () => {
        test('Promise 4, Actual 8: §4.3 wins over §4.2 → -40 (not +44)', () => {
            expect(Match.computeScore(4, 8)).toBe(-40);
        });
        test('Promise 5, Actual 10: §4.3 wins over §4.2 → -50 (not +55)', () => {
            expect(Match.computeScore(5, 10)).toBe(-50);
        });
        test('Just below boundary (Promise 5, Actual 9) stays in §4.2 → +54', () => {
            expect(Match.computeScore(5, 9)).toBe(54);
        });
    });

    describe('Integration — scores via Match.addRound', () => {
        let matchService, mockDb, team1, team2, matchId;

        beforeEach(async () => {
            const setup = createMatchService();
            matchService = setup.service;
            mockDb = setup.mockDb;
            const teams = await createTestTeams(mockDb);
            team1 = teams.team1;
            team2 = teams.team2;
            const created = await matchService.createMatch(team1.id, team2.id);
            matchId = created.id;
            await matchService.startMatch(matchId);
        });

        afterEach(() => mockDb.reset());

        test('Scores auto-derived when caller omits them', async () => {
            // Team1: Promise 6, Actual 6 → 60. Team2: Promise 8, Actual 7 → -80.
            await matchService.addRound(matchId, 6, 6, 8, 7);
            const m = await mockDb.getMatch(matchId);
            expect(m.rounds[0].team1.score).toBe(60);
            expect(m.rounds[0].team2.score).toBe(-80);
            expect(m.finalScore).toEqual({ team1: 60, team2: -80 });
        });

        test('Over-extension penalty applied in a real round', async () => {
            // Team1: Promise 4, Actual 9 → -40 (over). Team2: Promise 5, Actual 4 → -50 (under).
            await matchService.addRound(matchId, 4, 9, 5, 4);
            const m = await mockDb.getMatch(matchId);
            expect(m.rounds[0].team1.score).toBe(-40);
            expect(m.rounds[0].team2.score).toBe(-50);
        });

        test('Blind round records blind flag and fixed scores', async () => {
            // Team1 Blind, Actual 8 → +140. Team2: Promise 5, Actual 5 → 50.
            await matchService.addRound(matchId, 0, 8, 5, 5, undefined, undefined, { team1Blind: true });
            const m = await mockDb.getMatch(matchId);
            expect(m.rounds[0].team1.blind).toBe(true);
            expect(m.rounds[0].team1.promise).toBe(7);
            expect(m.rounds[0].team1.score).toBe(140);
            expect(m.rounds[0].team2.score).toBe(50);
        });

        test('Cumulative score across rounds', async () => {
            await matchService.addRound(matchId, 6, 6, 7, 7);   // +60 / +70
            await matchService.addRound(matchId, 8, 5, 5, 8);   // -80 / +53
            await matchService.addRound(matchId, 4, 0, 9, 13);  // -40 / +94 (actual 13 > 9*2=18? no — 13 < 18, so §4.2)
            const m = await mockDb.getMatch(matchId);
            // 60-80-40 = -60
            // 70+53+94 = 217
            expect(m.finalScore.team1).toBe(-60);
            expect(m.finalScore.team2).toBe(217);
        });
    });
});
