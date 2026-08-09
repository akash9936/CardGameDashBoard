// Mock DateUtils for testing environment
global.DateUtils = {
    safeDate: (date) => date ? new Date(date) : new Date()
};

const Match = require('../js/models/Match');

describe('Match State Transition Tests', () => {
    let match;

    beforeEach(() => {
        // Setup clean test environment
        match = new Match('test-match-1', 'team1', 'team2');
    });

    describe('TC_M005: Start pending match', () => {
        test('Status changes to in_progress', () => {
            // Initial state should be pending
            expect(match.status).toBe('pending');
            
            // Start the match
            match.start();
            
            // Verify status changed to in_progress
            expect(match.status).toBe('in_progress');
            
            // Verify history entry was added
            expect(match.history).toHaveLength(2); // match_created + match_started
            expect(match.history[1].action).toBe('match_started');
            expect(match.history[1].timestamp).toBeInstanceOf(Date);
        });
    });

    describe('TC_M006: Start already started match', () => {
        test('Error: Match already in progress', () => {
            // First start the match
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Try to start again - should throw error
            expect(() => {
                match.start();
            }).toThrow('Match must be in pending status to start');
            
            // Status should remain in_progress
            expect(match.status).toBe('in_progress');
        });
    });

    describe('TC_M007: Cancel pending match', () => {
        test('Status changes to cancelled', () => {
            // Initial state should be pending
            expect(match.status).toBe('pending');
            
            // Cancel the match
            const reason = 'Team unavailable';
            match.cancel(reason);
            
            // Verify status changed to cancelled
            expect(match.status).toBe('cancelled');
            
            // Verify history entry was added with reason
            expect(match.history).toHaveLength(2); // match_created + match_cancelled
            expect(match.history[1].action).toBe('match_cancelled');
            expect(match.history[1].details.reason).toBe(reason);
            expect(match.history[1].timestamp).toBeInstanceOf(Date);
        });
    });

    describe('TC_M008: Cancel in_progress match', () => {
        test('Status changes to cancelled', () => {
            // Start the match first
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Cancel the match
            const reason = 'Network issues';
            match.cancel(reason);
            
            // Verify status changed to cancelled
            expect(match.status).toBe('cancelled');
            
            // Verify history entries
            expect(match.history).toHaveLength(3); // match_created + match_started + match_cancelled
            expect(match.history[2].action).toBe('match_cancelled');
            expect(match.history[2].details.reason).toBe(reason);
        });
    });

    describe('TC_M009: Complete match when team reaches 500', () => {
        test('Status changes to completed', () => {
            // Start the match
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Add multiple rounds to build up score to 500
            // Using realistic scores: |promise - actual| × 10
            // Each round: team1 gets 90 points (|4-13|×10), team2 gets 0 (|6-6|×10)
            // Actual hands must sum to 13: 13 + 0 = 13
            for (let i = 0; i < 6; i++) {
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            // After 6 rounds: team1 should have 540 points
            
            // Verify status automatically changed to completed
            expect(match.status).toBe('completed');
            expect(match.winnerId).toBe('team1');
            expect(match.finalScore.team1).toBe(540);
            expect(match.finalScore.team2).toBe(0);
            
            // Verify history entries - the match should complete automatically
            const completedEntry = match.history.find(h => h.action === 'match_completed');
            expect(completedEntry).toBeDefined();
            expect(completedEntry.details.finalScore).toEqual({
                team1: 540,
                team2: 0
            });
            expect(completedEntry.details.winnerId).toBe('team1');
        });

        test('Team 2 reaches 500 and wins', () => {
            // Start the match
            match.start();
            
            // Add multiple rounds to build up score to 500
            // Each round: team1 gets 0 points, team2 gets 90 points
            // Actual hands must sum to 13: 0 + 13 = 13
            for (let i = 0; i < 6; i++) {
                match.addRound(6, 0, 4, 13, 0, 90);
                if (match.status === 'completed') break;
            }
            // After 6 rounds: team2 should have 540 points
            
            // Verify status and winner
            expect(match.status).toBe('completed');
            expect(match.winnerId).toBe('team2');
            expect(match.finalScore.team1).toBe(0);
            expect(match.finalScore.team2).toBe(540);
        });

        test('Team exceeds 500', () => {
            // Start the match
            match.start();
            
            // Add multiple rounds to exceed 500
            // Each round: team1 gets 80 points, team2 gets 40 points
            // Actual hands must sum to 13: 12 + 1 = 13
            for (let i = 0; i < 7; i++) {
                match.addRound(4, 12, 5, 1, 80, 40);
                if (match.status === 'completed') break;
            }
            // After multiple rounds: team1 should exceed 500
            
            // Verify status and winner
            expect(match.status).toBe('completed');
            expect(match.winnerId).toBe('team1');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);
        });
    });

    describe('TC_M010: Try to modify completed match', () => {
        test('Error: Match is completed', () => {
            // Start and complete the match
            match.start();
            // Build up to 500 with valid scores
            for (let i = 0; i < 6; i++) {
                // Actual hands must sum to 13: 13 + 0 = 13
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            expect(match.status).toBe('completed');
            
            // Try to add another round - should throw error
            expect(() => {
                match.addRound(6, 6, 7, 7, 10, 20);
            }).toThrow('Match must be in progress to add rounds');
            
            // Try to start completed match - should throw error
            expect(() => {
                match.start();
            }).toThrow('Match must be in pending status to start');
            
            // Try to complete already completed match - should throw error
            expect(() => {
                match.complete();
            }).toThrow('Match must be in progress to complete');
            
            // Status should remain completed
            expect(match.status).toBe('completed');
        });

        test('Cannot cancel completed match', () => {
            // Start and complete the match
            match.start();
            for (let i = 0; i < 6; i++) {
                // Actual hands must sum to 13: 13 + 0 = 13
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            expect(match.status).toBe('completed');
            
            // Try to cancel completed match - should throw error
            expect(() => {
                match.cancel('Testing');
            }).toThrow('Cannot cancel a completed match');
            
            // Status should remain completed
            expect(match.status).toBe('completed');
        });
    });

    describe('Edge Cases for State Transitions', () => {
        test('Multiple start attempts on pending match', () => {
            expect(match.status).toBe('pending');
            
            // First start should succeed
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Subsequent starts should fail
            expect(() => match.start()).toThrow('Match must be in pending status to start');
            expect(() => match.start()).toThrow('Match must be in pending status to start');
            
            expect(match.status).toBe('in_progress');
        });

        test('Cancel match with empty reason', () => {
            match.cancel('');
            expect(match.status).toBe('cancelled');
            expect(match.history[1].details.reason).toBe('');
        });

        test('Cancel match with no reason', () => {
            match.cancel();
            expect(match.status).toBe('cancelled');
            expect(match.history[1].details.reason).toBeUndefined();
        });

        test('Match progression through all valid states', () => {
            // pending -> in_progress
            expect(match.status).toBe('pending');
            match.start();
            expect(match.status).toBe('in_progress');
            
            // in_progress -> completed (automatically via winning score)
            for (let i = 0; i < 6; i++) {
                // Actual hands must sum to 13: 13 + 0 = 13
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            expect(match.status).toBe('completed');
            expect(match.winnerId).toBe('team1');
        });

        test('Match can be cancelled from in_progress state', () => {
            match.start();
            expect(match.status).toBe('in_progress');
            
            // Add a round (but not winning)
            // Actual hands must sum to 13: 8 + 5 = 13
            match.addRound(6, 8, 7, 5, 20, 20);
            expect(match.status).toBe('in_progress');
            
            // Cancel from in_progress
            match.cancel('Emergency');
            expect(match.status).toBe('cancelled');
        });

        test('Only team 1 crosses 500 - team 1 wins', () => {
            match.start();
            
            // Build up scores close to 500
            for (let i = 0; i < 5; i++) {
                // Actual hands must sum to 13: 13 + 0 = 13
                match.addRound(4, 13, 5, 0, 90, 50); // Team 1: 90, Team 2: 50 each round
            }
            // Final round where team 1 reaches exactly 500
            // Actual hands must sum to 13: 12 + 1 = 13
            match.addRound(4, 12, 5, 1, 80, 40); // Team 1: 450+80=530, Team 2: 250+40=290
            
            expect(match.status).toBe('completed');
            expect(match.winnerId).toBe('team1'); // First to reach 500
            expect(match.finalScore.team1).toBe(530);
            expect(match.finalScore.team2).toBe(290);
        });
    });

    describe('History Tracking', () => {
        test('History is properly maintained through state transitions', () => {
            // Initial state
            expect(match.history).toHaveLength(1);
            expect(match.history[0].action).toBe('match_created');
            
            // Start match
            match.start();
            expect(match.history).toHaveLength(2);
            expect(match.history[1].action).toBe('match_started');
            
            // Add round
            // Actual hands must sum to 13: 11 + 2 = 13
            match.addRound(6, 11, 7, 2, 50, 50);
            expect(match.history).toHaveLength(3);
            expect(match.history[2].action).toBe('round_added');
            
            // Complete match with multiple rounds to reach 500
            // Current score: team1=50, team2=50
            // Need at least 450 more for team1 to reach 500
            // Each round gives team1 90 points, so need 5 more rounds: 90*5 = 450
            for (let i = 0; i < 5; i++) {
                // Actual hands must sum to 13: 13 + 0 = 13
                match.addRound(4, 13, 6, 0, 90, 0);
                if (match.status === 'completed') break;
            }
            // Total: team1 = 50 + (5 × 90) = 500, team2 = 50
            expect(match.status).toBe('completed');
            expect(match.finalScore.team1).toBeGreaterThanOrEqual(500);
            
            // Find the match_completed entry in history
            const completedEntry = match.history.find(h => h.action === 'match_completed');
            expect(completedEntry).toBeDefined();
        });

        test('Cancel action adds proper history entry', () => {
            const reason = 'Weather conditions';
            match.cancel(reason);
            
            expect(match.history).toHaveLength(2);
            const cancelEntry = match.history[1];
            expect(cancelEntry.action).toBe('match_cancelled');
            expect(cancelEntry.details.reason).toBe(reason);
            expect(cancelEntry.timestamp).toBeInstanceOf(Date);
        });
    });
});