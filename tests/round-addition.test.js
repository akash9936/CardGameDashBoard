// Mock DateUtils for testing environment
global.DateUtils = {
    safeDate: (date) => date ? new Date(date) : new Date()
};

const Match = require('../js/models/Match');

describe('Round Addition Tests', () => {
    let match;

    beforeEach(() => {
        // Setup clean test environment
        match = new Match('test-match-1', 'team1', 'team2');
    });

    describe('TC_R015: Add round to pending match', () => {
        test('Error: Match not started', () => {
            // Initial state should be pending
            expect(match.status).toBe('pending');
            
            // Try to add round to pending match - should throw error
            expect(() => {
                match.addRound(6, 6, 7, 7, 0, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            // Status should remain pending
            expect(match.status).toBe('pending');
            
            // No rounds should be added
            expect(match.rounds).toHaveLength(0);
            expect(match.currentRound).toBe(0);
        });

        test('Different valid round data still fails on pending match', () => {
            expect(match.status).toBe('pending');
            
            // Try with different valid combinations
            expect(() => {
                match.addRound(4, 13, 6, 0, 90, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(() => {
                match.addRound(8, 5, 9, 8, 30, 10);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(match.status).toBe('pending');
        });
    });

    describe('TC_R016: Add round to in_progress match', () => {
        test('Round added successfully', () => {
            // Start the match
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Add a valid round
            // Promise validation: 4-13 range
            // Actual validation: must sum to 13
            // Score calculation: |promise - actual| × 10
            const team1Promise = 6;
            const team1Actual = 8;
            const team2Promise = 7;
            const team2Actual = 5;
            const team1Score = Math.abs(team1Promise - team1Actual) * 10; // |6-8| × 10 = 20
            const team2Score = Math.abs(team2Promise - team2Actual) * 10; // |7-5| × 10 = 20
            
            match.addRound(team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score);
            
            // Verify round was added successfully
            expect(match.rounds).toHaveLength(1);
            expect(match.currentRound).toBe(1);
            expect(match.status).toBe('in_progress'); // Should remain in progress
            
            // Verify round data
            const addedRound = match.rounds[0];
            expect(addedRound.roundNumber).toBe(1);
            expect(addedRound.team1.promise).toBe(team1Promise);
            expect(addedRound.team1.actual).toBe(team1Actual);
            expect(addedRound.team1.score).toBe(team1Score);
            expect(addedRound.team2.promise).toBe(team2Promise);
            expect(addedRound.team2.actual).toBe(team2Actual);
            expect(addedRound.team2.score).toBe(team2Score);
            
            // Verify final scores updated
            expect(match.finalScore.team1).toBe(team1Score);
            expect(match.finalScore.team2).toBe(team2Score);
            
            // Verify history entry added
            const roundAddedEntry = match.history.find(h => h.action === 'round_added');
            expect(roundAddedEntry).toBeDefined();
            expect(roundAddedEntry.details.roundNumber).toBe(1);
        });

        test('Multiple rounds can be added successfully', () => {
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Add first round
            match.addRound(6, 6, 7, 7, 0, 0); // Perfect matches
            expect(match.rounds).toHaveLength(1);
            expect(match.currentRound).toBe(1);
            expect(match.finalScore.team1).toBe(0);
            expect(match.finalScore.team2).toBe(0);
            
            // Add second round
            match.addRound(4, 13, 5, 0, 90, 50);
            expect(match.rounds).toHaveLength(2);
            expect(match.currentRound).toBe(2);
            expect(match.finalScore.team1).toBe(90);
            expect(match.finalScore.team2).toBe(50);
            
            // Add third round
            match.addRound(8, 5, 9, 8, 30, 10);
            expect(match.rounds).toHaveLength(3);
            expect(match.currentRound).toBe(3);
            expect(match.finalScore.team1).toBe(120);
            expect(match.finalScore.team2).toBe(60);
            
            // Match should still be in progress (no one reached 500)
            expect(match.status).toBe('in_progress');
        });

        test('Round addition updates round statistics correctly', () => {
            match.start();
            
            // Add round where team2 has higher score (team2 "wins" in terms of round stats)
            // Actual hands must sum to 13: 6 + 7 = 13
            match.addRound(6, 6, 7, 7, 0, 20);
            
            const stats = match.getRoundStats();
            // team2 scored higher (20 > 0), so team2 "won" the round
            expect(stats.team1.won).toBe(0);
            expect(stats.team1.lost).toBe(1);
            expect(stats.team2.won).toBe(1);
            expect(stats.team2.lost).toBe(0);
            
            // Add round where team1 has higher score (team1 "wins" in terms of round stats)
            // Actual hands must sum to 13: 5 + 8 = 13
            match.addRound(8, 5, 6, 8, 30, 0);
            
            const updatedStats = match.getRoundStats();
            // team1 scored higher (30 > 0), so team1 "won" the round
            expect(updatedStats.team1.won).toBe(1);
            expect(updatedStats.team1.lost).toBe(1);
            expect(updatedStats.team2.won).toBe(1);
            expect(updatedStats.team2.lost).toBe(1);
        });

        test('Round addition with tied scores', () => {
            match.start();
            
            // Add round with tied scores
            match.addRound(6, 8, 7, 5, 20, 20);
            
            const stats = match.getRoundStats();
            // Tied rounds don't update win/loss stats
            expect(stats.team1.won).toBe(0);
            expect(stats.team1.lost).toBe(0);
            expect(stats.team2.won).toBe(0);
            expect(stats.team2.lost).toBe(0);
            
            // But scores are still updated
            expect(match.finalScore.team1).toBe(20);
            expect(match.finalScore.team2).toBe(20);
        });
    });

    describe('TC_R017: Add round to completed match', () => {
        test('Error: Match is completed', () => {
            // Start and complete the match
            match.start();
            
            // Add rounds to complete the match (reach 500 points)
            for (let i = 0; i < 6; i++) {
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            
            expect(match.status).toBe('completed');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);
            
            const initialRoundCount = match.rounds.length;
            
            // Try to add another round - should throw error
            expect(() => {
                match.addRound(6, 6, 7, 7, 0, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            // Verify nothing changed
            expect(match.status).toBe('completed');
            expect(match.rounds).toHaveLength(initialRoundCount);
            expect(match.currentRound).toBe(initialRoundCount);
        });

        test('Different round data still fails on completed match', () => {
            // Complete match
            match.start();
            for (let i = 0; i < 6; i++) {
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            expect(match.status).toBe('completed');
            
            // Try different valid round combinations
            expect(() => {
                match.addRound(4, 0, 13, 13, 40, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(() => {
                match.addRound(8, 5, 9, 8, 30, 10);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(match.status).toBe('completed');
        });
    });

    describe('TC_R018: Add round to cancelled match', () => {
        test('Error: Match is cancelled', () => {
            // Cancel the match from pending state
            match.cancel('Team unavailable');
            expect(match.status).toBe('cancelled');
            
            // Try to add round - should throw error
            expect(() => {
                match.addRound(6, 6, 7, 7, 0, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            // Verify nothing changed
            expect(match.status).toBe('cancelled');
            expect(match.rounds).toHaveLength(0);
            expect(match.currentRound).toBe(0);
        });

        test('Error when match cancelled from in_progress state', () => {
            // Start match and add a round
            match.start();
            match.addRound(6, 6, 7, 7, 0, 0);
            expect(match.rounds).toHaveLength(1);
            
            // Cancel the match
            match.cancel('Network issues');
            expect(match.status).toBe('cancelled');
            
            const initialRoundCount = match.rounds.length;
            const initialCurrentRound = match.currentRound;
            
            // Try to add another round - should throw error
            expect(() => {
                match.addRound(8, 5, 9, 8, 30, 10);
            }).toThrow('Match must be in progress to add rounds');
            
            // Verify nothing changed
            expect(match.status).toBe('cancelled');
            expect(match.rounds).toHaveLength(initialRoundCount);
            expect(match.currentRound).toBe(initialCurrentRound);
        });

        test('Different round data still fails on cancelled match', () => {
            match.start();
            match.cancel('Testing cancellation');
            expect(match.status).toBe('cancelled');
            
            // Try various valid round combinations
            expect(() => {
                match.addRound(4, 13, 6, 0, 90, 0);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(() => {
                match.addRound(13, 13, 4, 0, 0, 40);
            }).toThrow('Match must be in progress to add rounds');
            
            expect(match.status).toBe('cancelled');
        });
    });

    describe('Edge Cases for Round Addition', () => {
        test('Round addition maintains history chronologically', () => {
            match.start();
            
            const startTime = Date.now();
            
            // Add multiple rounds
            match.addRound(6, 6, 7, 7, 0, 0);
            match.addRound(8, 5, 9, 8, 30, 10);
            match.addRound(4, 13, 5, 0, 90, 50);
            
            // Verify history entries
            const roundEntries = match.history.filter(h => h.action === 'round_added');
            expect(roundEntries).toHaveLength(3);
            
            // Verify chronological order
            expect(roundEntries[0].details.roundNumber).toBe(1);
            expect(roundEntries[1].details.roundNumber).toBe(2);
            expect(roundEntries[2].details.roundNumber).toBe(3);
            
            // Verify timestamps are after start time
            roundEntries.forEach(entry => {
                expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(startTime);
            });
        });

        test('Round addition validates all input constraints', () => {
            match.start();
            
            // These should all fail due to various validation rules
            
            // Invalid promise range
            expect(() => {
                match.addRound(3, 6, 7, 7, 30, 0); // team1 promise too low
            }).toThrow('Team 1 promise hand must be between 4 and 13');
            
            expect(() => {
                match.addRound(6, 6, 14, 7, 0, 70); // team2 promise too high
            }).toThrow('Team 2 promise hand must be between 4 and 13');
            
            // Invalid actual sum (must equal 13)
            expect(() => {
                match.addRound(6, 6, 7, 6, 0, 10); // actuals sum to 12
            }).toThrow('Actual hands of both teams must equal 13');
            
            expect(() => {
                match.addRound(6, 7, 7, 7, 10, 0); // actuals sum to 14
            }).toThrow('Actual hands of both teams must equal 13');
            
            // Invalid total score (exceeds 200)
            expect(() => {
                match.addRound(6, 6, 7, 7, 150, 100); // total = 250
            }).toThrow('Total score cannot be greater than 200');
            
            // Invalid total score (below -100)
            expect(() => {
                match.addRound(6, 6, 7, 7, -60, -50); // total = -110
            }).toThrow('Total score cannot be less than -100');
            
            // Match should still be in_progress and no rounds added
            expect(match.status).toBe('in_progress');
            expect(match.rounds).toHaveLength(0);
        });

        test('Automatic match completion when reaching 500 points', () => {
            match.start();
            
            // Add rounds until one team reaches 500
            let roundCount = 0;
            while (match.status === 'in_progress' && roundCount < 10) {
                match.addRound(4, 13, 6, 0, 90, 0);
                roundCount++;
            }
            
            // Match should auto-complete when team1 reaches 500+
            expect(match.status).toBe('completed');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);
            expect(match.winnerId).toBe('team1');
            
            // Verify match_completed entry in history
            const completedEntry = match.history.find(h => h.action === 'match_completed');
            expect(completedEntry).toBeDefined();
        });
    });
});