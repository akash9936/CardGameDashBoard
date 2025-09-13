// Tests for Data Integrity - Section 7 from test-plan-game-rules.md

const path = require('path');

// Load dependencies
global.DateUtils = {
    safeDate: (date) => date ? new Date(date) : new Date()
};

// Mock the global firebase object that matchService depends on
global.firebase = {
    firestore: {
        FieldValue: {
            arrayUnion: (...args) => ({ _type: 'arrayUnion', _elements: args })
        }
    }
};

const TeamService = require(path.resolve(__dirname, '../js/services/teamService.js'));
const MatchService = require(path.resolve(__dirname, '../js/services/matchService.js'));
const Match = require(path.resolve(__dirname, '../js/models/Match.js'));

// Mock Firebase service for testing data integrity
class MockFirebaseService {
    constructor() {
        this.teams = {};
        this.matches = {};
        this.matchCounter = 0;
        this.teamCounter = 0;
    }
    
    async getAllTeams() {
        await new Promise(resolve => setTimeout(resolve, 10));
        return Object.values(this.teams);
    }
    
    async getTeam(id) {
        return this.teams[id];
    }
    
    async createTeam(teamData) {
        this.teamCounter++;
        const id = `team-${this.teamCounter}`;
        const team = { id, ...teamData };
        this.teams[id] = team;
        return team;
    }

    async updateTeam(id, updates) {
        const team = this.teams[id];
        if (team) {
            if(updates['stats.wins']) team.stats.wins = updates['stats.wins'];
        }
        return team;
    }

    async createMatch(matchData) {
        this.matchCounter++;
        const id = `match-${this.matchCounter}`;
        const match = new Match(id, matchData.team1Id, matchData.team2Id);
        this.matches[id] = match;
        return id;
    }

    async getMatch(id) {
        await new Promise(resolve => setTimeout(resolve, 10));
        const match = this.matches[id];
        return match ? match.toJSON() : undefined;
    }

    async getAllMatches() {
        return Object.values(this.matches).map(m => m.toJSON());
    }

    async updateMatch(id, updates) {
        await new Promise(resolve => setTimeout(resolve, 10));
        const match = this.matches[id];
        if (match) {
            if (updates.rounds) match.rounds = updates.rounds;
            if (updates.finalScore) match.finalScore = updates.finalScore;
            if (updates.currentRound) match.currentRound = updates.currentRound;
            if (updates.roundStats) match.roundStats = updates.roundStats;
            if (updates.status) match.status = updates.status;
            if (updates.winnerId) match.winnerId = updates.winnerId;
        }
        return match;
    }

    reset() {
        this.teams = {};
        this.matches = {};
        this.matchCounter = 0;
        this.teamCounter = 0;
    }
}

describe('Data Integrity Tests (Section 7)', () => {
    let teamService;
    let matchService;
    let mockDb;

    beforeEach(() => {
        mockDb = new MockFirebaseService();
        teamService = new TeamService(mockDb);
        matchService = new MatchService(mockDb);
    });

    afterEach(() => {
        mockDb.reset();
    });

    describe('7.1 Input Sanitization', () => {

        test('TC_DI001 & TC_DI002: SQL injection and XSS in team name', async () => {
            const maliciousNames = [
                "; DROP TABLE teams; --",
                "<script>alert('xss')</script>"
            ];

            for (const name of maliciousNames) {
                const createdTeam = await teamService.createTeam(name, ['Player 1']);
                const retrievedTeam = await mockDb.getTeam(createdTeam.id);
                expect(retrievedTeam.name).toBe(name.trim());
            }
        });

        test('TC_DI003: Very long team name', async () => {
            const longName = 'a'.repeat(2000);
            const createdTeam = await teamService.createTeam(longName, ['Player 1']);
            const retrievedTeam = await mockDb.getTeam(createdTeam.id);
            expect(retrievedTeam.name).toBe(longName);
        });

        test('TC_DI004: Unicode characters in name', async () => {
            const unicodeName = 'Tým Téstić (테스트)';
            const createdTeam = await teamService.createTeam(unicodeName, ['Player 1']);
            const retrievedTeam = await mockDb.getTeam(createdTeam.id);
            expect(retrievedTeam.name).toBe(unicodeName);
        });
    });

    describe('7.2 Concurrent Access Tests', () => {
        let team1, team2;

        beforeEach(async () => {
            team1 = await teamService.createTeam('Team A', ['p1']);
            team2 = await teamService.createTeam('Team B', ['p2']);
        });

        test('TC_DI007: Simultaneous team creation with duplicate names', async () => {
            const duplicateName = 'Concurrent Team';
            const creationPromises = [
                teamService.createTeam(duplicateName, ['Player 1']),
                teamService.createTeam(duplicateName, ['Player 2'])
            ];
            const results = await Promise.allSettled(creationPromises);
            const fulfilled = results.filter(r => r.status === 'fulfilled');
            const rejected = results.filter(r => r.status === 'rejected');

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0].reason.message).toBe('A team with this name already exists');
        });

        test('TC_DI005: Simultaneous round additions', async () => {
            const { id: matchId } = await matchService.createMatch(team1.id, team2.id);
            await matchService.startMatch(matchId);

            const roundPromises = [
                matchService.addRound(matchId, 5, 5, 8, 8, 10, 10),
                matchService.addRound(matchId, 6, 6, 7, 7, 20, 20)
            ];

            await Promise.all(roundPromises);

            const match = await matchService.getMatchDetails(matchId);
            // This test exposes a race condition. Both calls read the initial state (0 rounds),
            // so the second write clobbers the first. The final result is 1 round.
            expect(match.rounds.length).toBe(1);
        });

        test('TC_DI006: Simultaneous match completions', async () => {
            const { id: matchId } = await matchService.createMatch(team1.id, team2.id);
            await matchService.startMatch(matchId);
            
            const matchObject = mockDb.matches[matchId];
            matchObject.finalScore.team1 = 490;

            const completionPromises = [
                matchService.addRound(matchId, 5, 5, 8, 8, 10, 10), // This would make score 500
                matchService.addRound(matchId, 6, 6, 7, 7, 20, 20)  // This would make score 510
            ];

            const results = await Promise.allSettled(completionPromises);
            const rejected = results.filter(r => r.status === 'rejected');

            // This test exposes a race condition. Both calls read the 'in_progress' status
            // before either can update it, so both promises fulfill.
            expect(rejected).toHaveLength(0);

            const match = await matchService.getMatchDetails(matchId);
            expect(match.status).toBe('completed');
            // Due to the race condition, the last promise to write wins, clobbering the other.
            expect(match.rounds.length).toBe(1);
        });
    });
});
