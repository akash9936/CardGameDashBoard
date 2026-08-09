// Mock DateUtils for testing environment
global.DateUtils = {
    safeDate: (date) => date ? new Date(date) : new Date()
};

const Team = require('../js/models/Team');
const Match = require('../js/models/Match');

describe('Statistics and Analytics Tests', () => {
    let team1, team2, match;

    beforeEach(() => {
        // Setup clean test environment
        team1 = new Team('team1', 'Team Alpha', ['Player 1', 'Player 2']);
        team2 = new Team('team2', 'Team Beta', ['Player 3', 'Player 4']);
        match = new Match('match1', 'team1', 'team2');
    });

    describe('6.1 Team Statistics Updates', () => {
        describe('TC_ST001: Match completion updates wins/losses', () => {
            test('Winner +1 win, Loser +1 loss', () => {
                // Start and complete match with team1 winning
                match.start();
                
                // Add rounds to make team1 win (reach 500 points)
                for (let i = 0; i < 6; i++) {
                    match.addRound(4, 13, 6, 0, 90, 0);
                    if (match.status === 'completed') break;
                }
                
                expect(match.status).toBe('completed');
                expect(match.winnerId).toBe('team1');
                
                // Update team statistics
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Verify winner gets +1 win
                expect(team1.stats.wins).toBe(1);
                expect(team1.stats.losses).toBe(0);
                expect(team1.stats.draws).toBe(0);
                
                // Verify loser gets +1 loss
                expect(team2.stats.wins).toBe(0);
                expect(team2.stats.losses).toBe(1);
                expect(team2.stats.draws).toBe(0);
            });

            test('Draw scenario - both teams get +1 draw', () => {
                // Create a manual draw scenario by directly setting winner to null
                match.start();
                match.addRound(6, 6, 7, 7, 20, 20);
                match.status = 'completed';
                match.winnerId = null; // Force draw
                
                // Update team statistics
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Both teams should get draws
                expect(team1.stats.wins).toBe(0);
                expect(team1.stats.losses).toBe(0);
                expect(team1.stats.draws).toBe(1);
                
                expect(team2.stats.wins).toBe(0);
                expect(team2.stats.losses).toBe(0);
                expect(team2.stats.draws).toBe(1);
            });
        });

        describe('TC_ST002: Points awarded correctly', () => {
            test('Winner +3 points, Loser +0 points', () => {
                // Complete match with team1 winning
                match.start();
                for (let i = 0; i < 6; i++) {
                    match.addRound(4, 13, 6, 0, 90, 0);
                    if (match.status === 'completed') break;
                }
                
                expect(match.winnerId).toBe('team1');
                
                // Update team statistics
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Winner gets 3 points
                expect(team1.stats.points).toBe(3);
                // Loser gets 0 points
                expect(team2.stats.points).toBe(0);
            });

            test('Draw awards 1 point to each team', () => {
                match.start();
                match.addRound(6, 6, 7, 7, 20, 20);
                match.status = 'completed';
                match.winnerId = null; // Force draw
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Both teams get 1 point for draw
                expect(team1.stats.points).toBe(1);
                expect(team2.stats.points).toBe(1);
            });
        });

        describe('TC_ST003: Total score accumulation', () => {
            test('Team total score updated', () => {
                match.start();
                
                // Add rounds to build specific scores
                match.addRound(6, 6, 7, 7, 0, 0);      // Team1: 0, Team2: 0
                match.addRound(4, 13, 5, 0, 90, 50);   // Team1: 90, Team2: 50
                match.addRound(8, 5, 9, 8, 30, 10);    // Team1: 30, Team2: 10
                
                // Final scores: Team1: 120, Team2: 60
                expect(match.finalScore.team1).toBe(120);
                expect(match.finalScore.team2).toBe(60);
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Verify total scores are accumulated
                expect(team1.stats.totalScore).toBe(120);
                expect(team2.stats.totalScore).toBe(60);
            });

            test('Multiple matches accumulate scores correctly', () => {
                // First match
                match.start();
                match.addRound(6, 6, 7, 7, 50, 30);
                match.status = 'completed';
                match.winnerId = 'team1';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                expect(team1.stats.totalScore).toBe(50);
                expect(team2.stats.totalScore).toBe(30);
                
                // Second match
                const match2 = new Match('match2', 'team1', 'team2');
                match2.start();
                match2.addRound(8, 5, 9, 8, 30, 10);
                match2.status = 'completed';
                match2.winnerId = 'team2';
                
                team1.updateStats(match2);
                team2.updateStats(match2);
                
                // Scores should accumulate
                expect(team1.stats.totalScore).toBe(80); // 50 + 30
                expect(team2.stats.totalScore).toBe(40); // 30 + 10
            });
        });

        describe('TC_ST004: Round statistics updates', () => {
            test('Rounds won/lost updated', () => {
                match.start();
                
                // Add rounds with specific win/loss patterns
                match.addRound(6, 6, 7, 7, 0, 20);     // Team2 wins round (higher score)
                match.addRound(8, 5, 9, 8, 30, 10);    // Team1 wins round (higher score)
                match.addRound(4, 13, 5, 0, 90, 50);   // Team1 wins round (higher score)
                
                // Check match round stats
                const stats = match.getRoundStats();
                expect(stats.team1.won).toBe(2);
                expect(stats.team1.lost).toBe(1);
                expect(stats.team2.won).toBe(1);
                expect(stats.team2.lost).toBe(2);
                
                match.status = 'completed';
                match.winnerId = 'team1';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Verify round statistics are updated in team stats
                expect(team1.stats.roundsWon).toBe(2);
                expect(team1.stats.roundsLost).toBe(1);
                expect(team2.stats.roundsWon).toBe(1);
                expect(team2.stats.roundsLost).toBe(2);
            });

            test('Round statistics accumulate across matches', () => {
                // First match
                match.start();
                match.addRound(6, 6, 7, 7, 0, 20); // Team2 wins
                match.status = 'completed';
                match.winnerId = 'team2';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                expect(team1.stats.roundsWon).toBe(0);
                expect(team1.stats.roundsLost).toBe(1);
                expect(team2.stats.roundsWon).toBe(1);
                expect(team2.stats.roundsLost).toBe(0);
                
                // Second match
                const match2 = new Match('match2', 'team1', 'team2');
                match2.start();
                match2.addRound(8, 5, 9, 8, 30, 10); // Team1 wins
                match2.addRound(4, 13, 5, 0, 90, 50); // Team1 wins
                match2.status = 'completed';
                match2.winnerId = 'team1';
                
                team1.updateStats(match2);
                team2.updateStats(match2);
                
                // Round stats should accumulate
                expect(team1.stats.roundsWon).toBe(2);  // 0 + 2
                expect(team1.stats.roundsLost).toBe(1); // 1 + 0
                expect(team2.stats.roundsWon).toBe(1);  // 1 + 0
                expect(team2.stats.roundsLost).toBe(2); // 0 + 2 (no additional loss from tied round)
            });
        });

        describe('TC_ST005: Matches played increment', () => {
            test('Both teams +1 matches played', () => {
                match.start();
                match.addRound(6, 6, 7, 7, 20, 30);
                match.status = 'completed';
                match.winnerId = 'team2';
                
                // Initial matches played should be 0
                expect(team1.stats.matchesPlayed).toBe(0);
                expect(team2.stats.matchesPlayed).toBe(0);
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Both teams should have +1 matches played
                expect(team1.stats.matchesPlayed).toBe(1);
                expect(team2.stats.matchesPlayed).toBe(1);
            });

            test('Multiple matches increment correctly', () => {
                // First match
                match.start();
                match.status = 'completed';
                match.winnerId = 'team1';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                expect(team1.stats.matchesPlayed).toBe(1);
                expect(team2.stats.matchesPlayed).toBe(1);
                
                // Second match
                const match2 = new Match('match2', 'team1', 'team2');
                match2.start();
                match2.status = 'completed';
                match2.winnerId = 'team2';
                
                team1.updateStats(match2);
                team2.updateStats(match2);
                
                // Should increment to 2
                expect(team1.stats.matchesPlayed).toBe(2);
                expect(team2.stats.matchesPlayed).toBe(2);
            });
        });
    });

    describe('6.2 Head-to-Head Statistics', () => {
        describe('TC_ST006: H2H record creation', () => {
            test('New H2H record between teams', () => {
                match.start();
                match.addRound(6, 6, 7, 7, 20, 30);
                match.status = 'completed';
                match.winnerId = 'team2';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Check that match history entries are created
                expect(team1.matchHistory).toHaveLength(1);
                expect(team2.matchHistory).toHaveLength(1);
                
                // Verify H2H record structure
                const team1H2H = team1.matchHistory[0];
                expect(team1H2H.matchId).toBe('match1');
                expect(team1H2H.opponentId).toBe('team2');
                expect(team1H2H.result).toBe('loss');
                expect(team1H2H.score).toBe(20);
                
                const team2H2H = team2.matchHistory[0];
                expect(team2H2H.matchId).toBe('match1');
                expect(team2H2H.opponentId).toBe('team1');
                expect(team2H2H.result).toBe('win');
                expect(team2H2H.score).toBe(30);
            });
        });

        describe('TC_ST007: H2H wins/losses update', () => {
            test('Correct H2H record updates', () => {
                // First match - team2 wins
                match.start();
                match.addRound(6, 6, 7, 7, 20, 30);
                match.status = 'completed';
                match.winnerId = 'team2';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Second match - team1 wins
                const match2 = new Match('match2', 'team1', 'team2');
                match2.start();
                match2.addRound(4, 13, 5, 0, 90, 50);
                match2.status = 'completed';
                match2.winnerId = 'team1';
                
                team1.updateStats(match2);
                team2.updateStats(match2);
                
                // Third match - draw
                const match3 = new Match('match3', 'team1', 'team2');
                match3.start();
                match3.addRound(6, 6, 7, 7, 25, 25);
                match3.status = 'completed';
                match3.winnerId = null;
                
                team1.updateStats(match3);
                team2.updateStats(match3);
                
                // Check H2H performance
                const team1VsTeam2 = team1.getPerformanceAgainst('team2');
                expect(team1VsTeam2.played).toBe(3);
                expect(team1VsTeam2.wins).toBe(1);
                expect(team1VsTeam2.losses).toBe(1);
                expect(team1VsTeam2.draws).toBe(1);
                
                const team2VsTeam1 = team2.getPerformanceAgainst('team1');
                expect(team2VsTeam1.played).toBe(3);
                expect(team2VsTeam1.wins).toBe(1);
                expect(team2VsTeam1.losses).toBe(1);
                expect(team2VsTeam1.draws).toBe(1);
            });
        });

        describe('TC_ST008: H2H average scores', () => {
            test('Correct H2H score averages', () => {
                // First match
                match.start();
                match.addRound(6, 6, 7, 7, 40, 60);
                match.status = 'completed';
                match.winnerId = 'team2';
                
                team1.updateStats(match);
                team2.updateStats(match);
                
                // Second match
                const match2 = new Match('match2', 'team1', 'team2');
                match2.start();
                match2.addRound(4, 13, 5, 0, 80, 20);
                match2.status = 'completed';
                match2.winnerId = 'team1';
                
                team1.updateStats(match2);
                team2.updateStats(match2);
                
                // Check total scores in H2H
                const team1VsTeam2 = team1.getPerformanceAgainst('team2');
                const team2VsTeam1 = team2.getPerformanceAgainst('team1');
                
                expect(team1VsTeam2.totalScore).toBe(120); // 40 + 80
                expect(team2VsTeam1.totalScore).toBe(80);  // 60 + 20
                
                // Calculate averages
                const team1AvgScore = team1VsTeam2.totalScore / team1VsTeam2.played;
                const team2AvgScore = team2VsTeam1.totalScore / team2VsTeam1.played;
                
                expect(team1AvgScore).toBe(60); // 120 / 2
                expect(team2AvgScore).toBe(40); // 80 / 2
            });
        });
    });

    describe('6.3 Recent Form Tracking', () => {
        describe('TC_ST009: First 5 matches form', () => {
            test('Correct form string (W/L/D)', () => {
                const matches = [];
                const results = ['win', 'loss', 'draw', 'win', 'loss'];
                
                // Create 5 matches with specific results
                results.forEach((result, index) => {
                    const testMatch = new Match(`match${index + 1}`, 'team1', 'team2');
                    testMatch.start();
                    testMatch.addRound(6, 6, 7, 7, 20, 20);
                    testMatch.status = 'completed';
                    
                    if (result === 'win') {
                        testMatch.winnerId = 'team1';
                    } else if (result === 'loss') {
                        testMatch.winnerId = 'team2';
                    } else {
                        testMatch.winnerId = null; // draw
                    }
                    
                    team1.updateStats(testMatch);
                    matches.push(testMatch);
                });
                
                // Get recent form (should be in reverse order - most recent first)
                const form = team1.getRecentForm();
                expect(form).toEqual(['loss', 'win', 'draw', 'loss', 'win']);
                expect(form).toHaveLength(5);
            });
        });

        describe('TC_ST010: Form after 6th match', () => {
            test('Oldest match dropped', () => {
                const results = ['win', 'loss', 'draw', 'win', 'loss', 'win'];
                
                // Create 6 matches
                results.forEach((result, index) => {
                    const testMatch = new Match(`match${index + 1}`, 'team1', 'team2');
                    testMatch.start();
                    testMatch.addRound(6, 6, 7, 7, 20, 20);
                    testMatch.status = 'completed';
                    
                    if (result === 'win') {
                        testMatch.winnerId = 'team1';
                    } else if (result === 'loss') {
                        testMatch.winnerId = 'team2';
                    } else {
                        testMatch.winnerId = null;
                    }
                    
                    team1.updateStats(testMatch);
                });
                
                // Form should only show last 5 matches, dropping the first 'win'
                const form = team1.getRecentForm();
                expect(form).toEqual(['win', 'loss', 'win', 'draw', 'loss']);
                expect(form).toHaveLength(5);
                
                // The form should be the last 5 matches in reverse order
                // Expected order: 6th(win), 5th(loss), 4th(win), 3rd(draw), 2nd(loss)
                // First match result ('win') is dropped, but 6th match is also 'win'
                expect(form[0]).toBe('win'); // 6th match 'win' should be first
                expect(form[4]).toBe('loss'); // 2nd match 'loss' should be last in form
            });
        });

        describe('TC_ST011: Form display order', () => {
            test('Most recent first', () => {
                const results = ['win', 'loss', 'draw'];
                
                results.forEach((result, index) => {
                    const testMatch = new Match(`match${index + 1}`, 'team1', 'team2');
                    testMatch.start();
                    testMatch.addRound(6, 6, 7, 7, 20, 20);
                    testMatch.status = 'completed';
                    
                    if (result === 'win') {
                        testMatch.winnerId = 'team1';
                    } else if (result === 'loss') {
                        testMatch.winnerId = 'team2';
                    } else {
                        testMatch.winnerId = null;
                    }
                    
                    team1.updateStats(testMatch);
                });
                
                // Form should be in reverse chronological order
                const form = team1.getRecentForm();
                expect(form).toEqual(['draw', 'loss', 'win']); // Most recent first
                
                // Verify the match history is in correct order
                expect(team1.matchHistory).toHaveLength(3);
                expect(team1.matchHistory[0].result).toBe('win');   // First match
                expect(team1.matchHistory[1].result).toBe('loss');  // Second match
                expect(team1.matchHistory[2].result).toBe('draw');  // Third match (most recent)
            });
        });
    });

    describe('Edge Cases and Additional Analytics', () => {
        test('Win rate calculation', () => {
            // No matches played
            expect(team1.getWinRate()).toBe(0);
            
            // Add some matches
            for (let i = 0; i < 4; i++) {
                const testMatch = new Match(`match${i + 1}`, 'team1', 'team2');
                testMatch.start();
                testMatch.status = 'completed';
                
                if (i < 3) {
                    testMatch.winnerId = 'team1'; // 3 wins
                } else {
                    testMatch.winnerId = 'team2'; // 1 loss
                }
                
                team1.updateStats(testMatch);
            }
            
            // Win rate should be 75% (3 wins out of 4 matches)
            expect(team1.getWinRate()).toBe(75);
        });

        test('Statistics consistency after multiple updates', () => {
            // Create multiple matches and verify all stats remain consistent
            for (let i = 0; i < 3; i++) {
                const testMatch = new Match(`match${i + 1}`, 'team1', 'team2');
                testMatch.start();
                
                // Add some rounds
                testMatch.addRound(6, 6, 7, 7, 10, 20);
                testMatch.addRound(8, 5, 9, 8, 30, 10);
                
                testMatch.status = 'completed';
                testMatch.winnerId = i % 2 === 0 ? 'team1' : 'team2';
                
                team1.updateStats(testMatch);
                team2.updateStats(testMatch);
            }
            
            // Verify totals are consistent
            expect(team1.stats.matchesPlayed).toBe(3);
            expect(team2.stats.matchesPlayed).toBe(3);
            expect(team1.stats.wins + team1.stats.losses + team1.stats.draws).toBe(3);
            expect(team2.stats.wins + team2.stats.losses + team2.stats.draws).toBe(3);
            
            // Verify match history length matches matches played
            expect(team1.matchHistory).toHaveLength(3);
            expect(team2.matchHistory).toHaveLength(3);
        });
    });
});