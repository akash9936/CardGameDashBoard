class MatchService {
    constructor(firebaseService) {
        this.firebaseService = firebaseService;
    }

    // Create a new match
    async createMatch(team1Id, team2Id) {
        // Validate teams
        const team1 = await this.firebaseService.getTeam(team1Id);
        const team2 = await this.firebaseService.getTeam(team2Id);

        if (!team1 || !team2) {
            throw new Error('One or both teams not found');
        }

        if (team1Id === team2Id) {
            throw new Error('A team cannot play against itself');
        }

        // Check for existing pending matches between these teams
        const existingMatches = await this.firebaseService.getAllMatches();
        const existingMatch = existingMatches.find(match => 
                match.status === 'pending' &&
                ((match.team1Id === team1Id && match.team2Id === team2Id) ||
                 (match.team1Id === team2Id && match.team2Id === team1Id))
            );

        if (existingMatch) {
            throw new Error('There is already a pending match between these teams');
        }

        const matchData = {
            team1Id: team1Id,
            team2Id: team2Id,
            date: new Date(),
            status: 'pending',
            currentRound: 0,
            rounds: [],
            roundStats: {
                team1: { won: 0, lost: 0 },
                team2: { won: 0, lost: 0 }
            },
            finalScore: { team1: 0, team2: 0 },
            winnerId: null,
            history: []
        };

        const matchId = await this.firebaseService.createMatch(matchData);
        return { id: matchId };
    }

    // Get match details
    async getMatchDetails(matchId) {
        const match = await this.firebaseService.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        const team1 = await this.firebaseService.getTeam(match.team1Id);
        const team2 = await this.firebaseService.getTeam(match.team2Id);

        return {
            ...match,
            teams: {
                team1: team1,
                team2: team2
            }
        };
    }

    // Get all matches with optional filters
    async getAllMatches(filters = {}) {
        let matches = await this.firebaseService.getAllMatches();

        // Apply filters
        if (filters.status) {
            matches = matches.filter(match => match.status === filters.status);
        }

        if (filters.teamId) {
            matches = matches.filter(match => 
                match.team1Id === filters.teamId || match.team2Id === filters.teamId
            );
        }

        // Sort by date (most recent first)
        return matches.sort((a, b) => DateUtils.safeDate(b.date) - DateUtils.safeDate(a.date));
    }

    // Get recent matches
    async getRecentMatches(limit = 10) {
        const matches = await this.getAllMatches();
        return matches.slice(0, limit);
    }

    async addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score) {
        const match = await this.firebaseService.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        if (match.status !== 'in_progress') {
            throw new Error('Match must be in progress to add rounds');
        }

        // Validate inputs
        if (team1Promise < 0 || team1Actual < 0 || team2Promise < 0 || team2Actual < 0) {
            throw new Error('Promise and actual values cannot be negative');
        }

        // Validate actual hands must equal 13
        if (team1Actual + team2Actual !== 13) {
            throw new Error('Actual hands of both teams must equal 13');
        }

        // Validate promise hands must be between 4 and 13
        if (team1Promise < 4 || team1Promise > 13) {
            throw new Error('Team 1 promise hand must be between 4 and 13');
        }
        if (team2Promise < 4 || team2Promise > 13) {
            throw new Error('Team 2 promise hand must be between 4 and 13');
        }

        // Validate total score limits
        const totalScore = team1Score + team2Score;
        if (totalScore > 200) {
            throw new Error('Total score cannot be greater than 200');
        }
        if (totalScore < -100) {
            throw new Error('Total score cannot be less than -100');
        }

        const newRound = {
            roundNumber: match.currentRound + 1,
            team1: { promise: team1Promise, actual: team1Actual, score: team1Score },
            team2: { promise: team2Promise, actual: team2Actual, score: team2Score }
        };

        const updatedRounds = [...match.rounds, newRound];
        const updatedFinalScore = {
            team1: match.finalScore.team1 + team1Score,
            team2: match.finalScore.team2 + team2Score
        };

        // Calculate round statistics
        const currentRoundStats = match.roundStats || {
            team1: { won: 0, lost: 0 },
            team2: { won: 0, lost: 0 }
        };

        const updatedRoundStats = {
            team1: { ...currentRoundStats.team1 },
            team2: { ...currentRoundStats.team2 }
        };

        // Update round stats based on scores
        if (team1Score > team2Score) {
            updatedRoundStats.team1.won = (updatedRoundStats.team1.won || 0) + 1;
            updatedRoundStats.team2.lost = (updatedRoundStats.team2.lost || 0) + 1;
        } else if (team2Score > team1Score) {
            updatedRoundStats.team2.won = (updatedRoundStats.team2.won || 0) + 1;
            updatedRoundStats.team1.lost = (updatedRoundStats.team1.lost || 0) + 1;
        }

        const updates = {
            rounds: updatedRounds,
            finalScore: updatedFinalScore,
            currentRound: match.currentRound + 1,
            roundStats: updatedRoundStats
        };

        if (updatedFinalScore.team1 >= 500 || updatedFinalScore.team2 >= 500) {
            updates.status = 'completed';
            updates.winnerId = updatedFinalScore.team1 >= 500 ? match.team1Id : match.team2Id;
            
            // Update team statistics when match is completed
            await this.updateTeamStats(match.team1Id, match.team2Id, { ...updates, id: matchId });
        }

        await this.firebaseService.updateMatch(matchId, updates);
    }

    async startMatch(matchId) {
        await this.firebaseService.updateMatch(matchId, { status: 'in_progress' });
    }

    async cancelMatch(matchId, reason) {
        await this.firebaseService.updateMatch(matchId, { status: 'cancelled', cancellationReason: reason });
    }

    // Update team statistics when a match is completed
    async updateTeamStats(team1Id, team2Id, matchUpdates) {
        try {
            const team1 = await this.firebaseService.getTeam(team1Id);
            const team2 = await this.firebaseService.getTeam(team2Id);
            
            if (!team1 || !team2) {
                console.warn('One or both teams not found for stats update');
                return;
            }

            // Calculate team scores
            const team1Score = matchUpdates.finalScore.team1;
            const team2Score = matchUpdates.finalScore.team2;
            
            // Determine winner
            const winnerId = matchUpdates.winnerId;
            
            // Update team 1 stats
            const team1Updates = {
                'stats.matchesPlayed': (team1.stats?.matchesPlayed || 0) + 1,
                'stats.totalScore': (team1.stats?.totalScore || 0) + team1Score
            };
            
            if (winnerId === team1Id) {
                team1Updates['stats.wins'] = (team1.stats?.wins || 0) + 1;
                team1Updates['stats.points'] = (team1.stats?.points || 0) + 3;
            } else if (winnerId === team2Id) {
                team1Updates['stats.losses'] = (team1.stats?.losses || 0) + 1;
            } else {
                team1Updates['stats.draws'] = (team1.stats?.draws || 0) + 1;
                team1Updates['stats.points'] = (team1.stats?.points || 0) + 1;
            }
            
            // Update team 2 stats
            const team2Updates = {
                'stats.matchesPlayed': (team2.stats?.matchesPlayed || 0) + 1,
                'stats.totalScore': (team2.stats?.totalScore || 0) + team2Score
            };
            
            if (winnerId === team2Id) {
                team2Updates['stats.wins'] = (team2.stats?.wins || 0) + 1;
                team2Updates['stats.points'] = (team2.stats?.points || 0) + 3;
            } else if (winnerId === team1Id) {
                team2Updates['stats.losses'] = (team2.stats?.losses || 0) + 1;
            } else {
                team2Updates['stats.draws'] = (team2.stats?.draws || 0) + 1;
                team2Updates['stats.points'] = (team2.stats?.points || 0) + 1;
            }
            
            // Update round statistics if available
            if (matchUpdates.roundStats) {
                team1Updates['stats.roundsWon'] = (team1.stats?.roundsWon || 0) + (matchUpdates.roundStats.team1?.won || 0);
                team1Updates['stats.roundsLost'] = (team1.stats?.roundsLost || 0) + (matchUpdates.roundStats.team1?.lost || 0);
                team2Updates['stats.roundsWon'] = (team2.stats?.roundsWon || 0) + (matchUpdates.roundStats.team2?.won || 0);
                team2Updates['stats.roundsLost'] = (team2.stats?.roundsLost || 0) + (matchUpdates.roundStats.team2?.lost || 0);
            }
            
            // Add match to team history
            const team1HistoryEntry = {
                matchId: matchUpdates.id || Date.now(),
                opponentId: team2Id,
                result: winnerId === team1Id ? 'win' : winnerId === team2Id ? 'loss' : 'draw',
                date: new Date(),
                score: team1Score
            };
            
            const team2HistoryEntry = {
                matchId: matchUpdates.id || Date.now(),
                opponentId: team1Id,
                result: winnerId === team2Id ? 'win' : winnerId === team1Id ? 'loss' : 'draw',
                date: new Date(),
                score: team2Score
            };
            
            team1Updates['matchHistory'] = firebase.firestore.FieldValue.arrayUnion(team1HistoryEntry);
            team2Updates['matchHistory'] = firebase.firestore.FieldValue.arrayUnion(team2HistoryEntry);
            
            // Update both teams
            await Promise.all([
                this.firebaseService.updateTeam(team1Id, team1Updates),
                this.firebaseService.updateTeam(team2Id, team2Updates)
            ]);
            
            console.log('Team statistics updated successfully');
        } catch (error) {
            console.error('Error updating team statistics:', error);
        }
    }

    // Recalculate all team statistics from existing matches
    async recalculateAllTeamStats() {
        try {
            console.log('Starting team statistics recalculation...');
            
            const allMatches = await this.firebaseService.getAllMatches();
            const allTeams = await this.firebaseService.getAllTeams();
            
            // Reset all team statistics
            const resetPromises = allTeams.map(team => {
                const resetStats = {
                    'stats.matchesPlayed': 0,
                    'stats.wins': 0,
                    'stats.losses': 0,
                    'stats.draws': 0,
                    'stats.points': 0,
                    'stats.totalScore': 0,
                    'stats.roundsWon': 0,
                    'stats.roundsLost': 0,
                    'matchHistory': []
                };
                return this.firebaseService.updateTeam(team.id, resetStats);
            });
            
            await Promise.all(resetPromises);
            console.log('Reset all team statistics');
            
            // Process completed matches
            const completedMatches = allMatches.filter(match => match.status === 'completed');
            console.log(`Processing ${completedMatches.length} completed matches`);
            
            for (const match of completedMatches) {
                await this.updateTeamStats(match.team1Id, match.team2Id, match);
            }
            
            console.log('Team statistics recalculation completed');
        } catch (error) {
            console.error('Error recalculating team statistics:', error);
        }
    }
}

// Create a singleton instance - will be initialized in app.js
let matchService = null;

// Function to initialize the service
function initializeMatchService(firebaseService) {
    matchService = new MatchService(firebaseService);
    return matchService;
} 