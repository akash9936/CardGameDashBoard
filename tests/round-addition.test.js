// Round Addition tests — exercises Match.addRound lifecycle.
// Scoring values are derived by Match.computeScore (CLAUDE.md §4) so this
// suite focuses on mechanics (rounds, currentRound, status, history), not
// on a specific scoring formula.

global.DateUtils = {
    safeDate: (date) => date ? new Date(date) : new Date()
};

const Match = require('../js/models/Match');

describe('Round Addition Tests', () => {
    let match;

    beforeEach(() => {
        match = new Match('test-match-1', 'team1', 'team2');
    });

    describe('TC_R015: Add round to pending match', () => {
        test('Error: Match not started', () => {
            expect(match.status).toBe('pending');

            expect(() => {
                match.addRound(6, 6, 7, 7);
            }).toThrow('Match must be in progress to add rounds');

            expect(match.status).toBe('pending');
            expect(match.rounds).toHaveLength(0);
            expect(match.currentRound).toBe(0);
        });

        test('Different valid round data still fails on pending match', () => {
            expect(match.status).toBe('pending');

            expect(() => match.addRound(4, 13, 6, 0)).toThrow('Match must be in progress');
            expect(() => match.addRound(8, 5, 9, 8)).toThrow('Match must be in progress');

            expect(match.status).toBe('pending');
        });
    });

    describe('TC_R016: Add round to in_progress match', () => {
        test('Round added successfully', () => {
            match.start();
            expect(match.status).toBe('in_progress');

            // Promise 6 / Actual 8 → §4.2 (8 < 12) → 6*10+2 = 62
            // Promise 7 / Actual 5 → §4.1 → -(7*10) = -70
            match.addRound(6, 8, 7, 5);

            expect(match.rounds).toHaveLength(1);
            expect(match.currentRound).toBe(1);
            expect(match.status).toBe('in_progress');

            const added = match.rounds[0];
            expect(added.roundNumber).toBe(1);
            expect(added.team1.promise).toBe(6);
            expect(added.team1.actual).toBe(8);
            expect(added.team1.score).toBe(Match.computeScore(6, 8));
            expect(added.team2.promise).toBe(7);
            expect(added.team2.actual).toBe(5);
            expect(added.team2.score).toBe(Match.computeScore(7, 5));

            expect(match.finalScore.team1).toBe(Match.computeScore(6, 8));
            expect(match.finalScore.team2).toBe(Match.computeScore(7, 5));

            const entry = match.history.find(h => h.action === 'round_added');
            expect(entry).toBeDefined();
            expect(entry.details.roundNumber).toBe(1);
        });

        test('Multiple rounds can be added successfully', () => {
            match.start();

            match.addRound(6, 6, 7, 7);
            expect(match.rounds).toHaveLength(1);
            expect(match.currentRound).toBe(1);

            match.addRound(4, 6, 5, 7);
            expect(match.rounds).toHaveLength(2);
            expect(match.currentRound).toBe(2);

            match.addRound(8, 5, 9, 8);
            expect(match.rounds).toHaveLength(3);
            expect(match.currentRound).toBe(3);

            expect(match.status).toBe('in_progress');
        });

        test('Round addition updates round statistics correctly', () => {
            match.start();

            // Round 1: team1 (6,6 → 60), team2 (7,7 → 70). team2 wins round.
            match.addRound(6, 6, 7, 7);
            let stats = match.getRoundStats();
            expect(stats.team1.won).toBe(0);
            expect(stats.team1.lost).toBe(1);
            expect(stats.team2.won).toBe(1);
            expect(stats.team2.lost).toBe(0);

            // Round 2: team1 (8,8 → 80), team2 (6,5 → -60). team1 wins.
            match.addRound(8, 8, 6, 5);
            stats = match.getRoundStats();
            expect(stats.team1.won).toBe(1);
            expect(stats.team1.lost).toBe(1);
            expect(stats.team2.won).toBe(1);
            expect(stats.team2.lost).toBe(1);
        });

        test('Round addition with tied scores', () => {
            match.start();

            // Force a tie by passing equal explicit scores
            match.addRound(6, 8, 7, 5, 20, 20);

            const stats = match.getRoundStats();
            expect(stats.team1.won).toBe(0);
            expect(stats.team1.lost).toBe(0);
            expect(stats.team2.won).toBe(0);
            expect(stats.team2.lost).toBe(0);

            expect(match.finalScore.team1).toBe(20);
            expect(match.finalScore.team2).toBe(20);
        });
    });

    describe('TC_R017: Add round to completed match', () => {
        test('Error: Match is completed', () => {
            match.start();

            // Promise 13 / Actual 13 → +130; promise 4 / actual 0 → -40 → drive team1 to 500
            for (let i = 0; i < 5; i++) {
                match.addRound(13, 13, 4, 0);
                if (match.status === 'completed') break;
            }

            expect(match.status).toBe('completed');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);

            const initialRoundCount = match.rounds.length;

            expect(() => match.addRound(6, 6, 7, 7)).toThrow('Match must be in progress to add rounds');

            expect(match.status).toBe('completed');
            expect(match.rounds).toHaveLength(initialRoundCount);
            expect(match.currentRound).toBe(initialRoundCount);
        });

        test('Different round data still fails on completed match', () => {
            match.start();
            for (let i = 0; i < 5; i++) {
                match.addRound(13, 13, 4, 0);
                if (match.status === 'completed') break;
            }
            expect(match.status).toBe('completed');

            expect(() => match.addRound(4, 0, 13, 13)).toThrow('Match must be in progress');
            expect(() => match.addRound(8, 5, 9, 8)).toThrow('Match must be in progress');

            expect(match.status).toBe('completed');
        });
    });

    describe('TC_R018: Add round to cancelled match', () => {
        test('Error: Match is cancelled', () => {
            match.cancel('Team unavailable');
            expect(match.status).toBe('cancelled');

            expect(() => match.addRound(6, 6, 7, 7)).toThrow('Match must be in progress to add rounds');

            expect(match.status).toBe('cancelled');
            expect(match.rounds).toHaveLength(0);
            expect(match.currentRound).toBe(0);
        });

        test('Error when match cancelled from in_progress state', () => {
            match.start();
            match.addRound(6, 6, 7, 7);
            expect(match.rounds).toHaveLength(1);

            match.cancel('Network issues');
            expect(match.status).toBe('cancelled');

            const initialRoundCount = match.rounds.length;
            const initialCurrentRound = match.currentRound;

            expect(() => match.addRound(8, 5, 9, 8)).toThrow('Match must be in progress');

            expect(match.status).toBe('cancelled');
            expect(match.rounds).toHaveLength(initialRoundCount);
            expect(match.currentRound).toBe(initialCurrentRound);
        });

        test('Different round data still fails on cancelled match', () => {
            match.start();
            match.cancel('Testing cancellation');
            expect(match.status).toBe('cancelled');

            expect(() => match.addRound(4, 6, 5, 7)).toThrow('Match must be in progress');
            expect(() => match.addRound(13, 13, 4, 0)).toThrow('Match must be in progress');

            expect(match.status).toBe('cancelled');
        });
    });

    describe('Edge Cases for Round Addition', () => {
        test('Round addition maintains history chronologically', () => {
            match.start();
            const startTime = Date.now();

            match.addRound(6, 6, 7, 7);
            match.addRound(8, 5, 9, 8);
            match.addRound(4, 6, 5, 7);

            const roundEntries = match.history.filter(h => h.action === 'round_added');
            expect(roundEntries).toHaveLength(3);

            expect(roundEntries[0].details.roundNumber).toBe(1);
            expect(roundEntries[1].details.roundNumber).toBe(2);
            expect(roundEntries[2].details.roundNumber).toBe(3);

            roundEntries.forEach(entry => {
                expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(startTime);
            });
        });

        test('Round addition validates all input constraints', () => {
            match.start();

            // Invalid promise range (CLAUDE.md §3.1)
            expect(() => match.addRound(3, 6, 7, 7))
                .toThrow('Team 1 promise hand must be between 4 and 13');
            expect(() => match.addRound(6, 6, 14, 7))
                .toThrow('Team 2 promise hand must be between 4 and 13');

            // Invalid actual sum (CLAUDE.md §3.2)
            expect(() => match.addRound(6, 6, 7, 6))
                .toThrow('Actual hands of both teams must equal 13');
            expect(() => match.addRound(6, 7, 7, 7))
                .toThrow('Actual hands of both teams must equal 13');

            // Negative actuals (CLAUDE.md §3.2)
            expect(() => match.addRound(6, -1, 7, 14))
                .toThrow('Actual hands cannot be negative');

            expect(match.status).toBe('in_progress');
            expect(match.rounds).toHaveLength(0);
        });

        test('Automatic match completion when reaching 500 points', () => {
            match.start();

            // Team1: promise 13, actual 13 → +130 per round.
            // Need 4 rounds to exceed 500: 130*4 = 520.
            let roundCount = 0;
            while (match.status === 'in_progress' && roundCount < 10) {
                match.addRound(13, 13, 4, 0);
                roundCount++;
            }

            expect(match.status).toBe('completed');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);
            expect(match.winnerId).toBe('team1');

            const completedEntry = match.history.find(h => h.action === 'match_completed');
            expect(completedEntry).toBeDefined();
        });
    });
});
