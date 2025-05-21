class MatchService {
    constructor(storage) {
        this.storage = storage;
    }

    // Create a new match
    createMatch(team1Id, team2Id) {
        // Validate teams
        const team1 = this.storage.getTeam(team1Id);
        const team2 = this.storage.getTeam(team2Id);

        if (!team1 || !team2) {
            throw new Error('One or both teams not found');
        }

        if (team1Id === team2Id) {
            throw new Error('A team cannot play against itself');
        }

        // Check for existing pending matches between these teams
        const existingMatch = this.storage.getAllMatches()
            .find(match => 
                match.status === 'pending' &&
                ((match.team1Id === team1Id && match.team2Id === team2Id) ||
                 (match.team1Id === team2Id && match.team2Id === team1Id))
            );

        if (existingMatch) {
            throw new Error('There is already a pending match between these teams');
        }

        return this.storage.addMatch(team1Id, team2Id);
    }

    // Get match details
    getMatchDetails(matchId) {
        const match = this.storage.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        const team1 = this.storage.getTeam(match.team1Id);
        const team2 = this.storage.getTeam(match.team2Id);

        return {
            ...match.getSummary(),
            teams: {
                team1: {
                    id: team1.id,
                    name: team1.name,
                    stats: team1.stats
                },
                team2: {
                    id: team2.id,
                    name: team2.name,
                    stats: team2.stats
                }
            },
            history: match.history
        };
    }

    // Update match score
    updateMatchScore(matchId, team1Score, team2Score) {
        const match = this.storage.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        if (match.status !== 'pending') {
            throw new Error('Cannot update score of a completed or cancelled match');
        }

        if (team1Score < 0 || team2Score < 0) {
            throw new Error('Scores cannot be negative');
        }

        match.updateScore(team1Score, team2Score);
        return this.storage.updateMatch(match);
    }

    // Complete a match
    completeMatch(matchId) {
        const match = this.storage.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        if (match.status !== 'pending') {
            throw new Error('Match is not in pending status');
        }

        match.complete();
        return this.storage.updateMatch(match);
    }

    // Cancel a match
    cancelMatch(matchId, reason) {
        const match = this.storage.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        if (match.status !== 'pending') {
            throw new Error('Match is not in pending status');
        }

        match.cancel(reason);
        return this.storage.updateMatch(match);
    }

    // Start a match
    startMatch(matchId) {
        const match = this.storage.getMatch(matchId);
        if (!match) {
            throw new Error('Match not found');
        }

        if (match.status !== 'pending') {
            throw new Error('Match must be in pending status to start');
        }

        match.start();
        return this.storage.updateMatch(match);
    }

    // Get all matches with optional filters
    getAllMatches(filters = {}) {
        let matches = this.storage.getAllMatches();

        // Apply filters
        if (filters.status) {
            matches = matches.filter(match => match.status === filters.status);
        }

        if (filters.teamId) {
            matches = matches.filter(match => 
                match.team1Id === filters.teamId || match.team2Id === filters.teamId
            );
        }

        if (filters.startDate) {
            const startDate = new Date(filters.startDate);
            matches = matches.filter(match => new Date(match.date) >= startDate);
        }

        if (filters.endDate) {
            const endDate = new Date(filters.endDate);
            matches = matches.filter(match => new Date(match.date) <= endDate);
        }

        // Sort by date (most recent first)
        return matches
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .map(match => ({
                ...match.getSummary(),
                team1Id: match.team1Id,
                team2Id: match.team2Id
            }));
    }

    // Get recent matches
    getRecentMatches(limit = 10) {
        return this.getAllMatches()
            .slice(0, limit);
    }

    // Get upcoming matches (pending matches)
    getUpcomingMatches() {
        return this.getAllMatches({ status: 'pending' });
    }

    // Get match statistics
    getMatchStatistics() {
        const matches = this.storage.getAllMatches();
        const completedMatches = matches.filter(match => match.status === 'completed');
        
        return {
            total: matches.length,
            completed: completedMatches.length,
            cancelled: matches.filter(match => match.status === 'cancelled').length,
            pending: matches.filter(match => match.status === 'pending').length,
            averageScore: completedMatches.length > 0 ? {
                team1: completedMatches.reduce((sum, match) => sum + match.score.team1, 0) / completedMatches.length,
                team2: completedMatches.reduce((sum, match) => sum + match.score.team2, 0) / completedMatches.length
            } : { team1: 0, team2: 0 },
            draws: completedMatches.filter(match => match.winnerId === null).length
        };
    }

    // Search matches
    searchMatches(query) {
        if (!query) return this.getAllMatches();

        const searchTerm = query.toLowerCase();
        const teams = this.storage.getAllTeams()
            .filter(team => team.name.toLowerCase().includes(searchTerm));

        return this.storage.getAllMatches()
            .filter(match => {
                const team1 = this.storage.getTeam(match.team1Id);
                const team2 = this.storage.getTeam(match.team2Id);
                return teams.some(team => 
                    team.id === match.team1Id || team.id === match.team2Id
                );
            })
            .map(match => {
                const team1 = this.storage.getTeam(match.team1Id);
                const team2 = this.storage.getTeam(match.team2Id);
                return {
                    ...match.getSummary(),
                    teams: {
                        team1: {
                            id: team1.id,
                            name: team1.name
                        },
                        team2: {
                            id: team2.id,
                            name: team2.name
                        }
                    }
                };
            });
    }

    // Add a round to a match
    addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score) {
        const match = this.storage.getMatch(matchId);
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

        // Add the round with user-entered scores
        match.addRound(team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score);
        
        // Update the match in storage
        return this.storage.updateMatch(match);
    }
}

// Create a singleton instance
const matchService = new MatchService(storage); 