class Match {
    constructor(id, team1Id, team2Id, date = new Date()) {
        this.id = id;
        this.team1Id = team1Id;
        this.team2Id = team2Id;
        this.date = date;
        this.status = 'pending'; // pending, in_progress, completed, cancelled
        this.currentRound = 0;
        this.rounds = []; // Array of round data
        this.finalScore = { team1: 0, team2: 0 };
        this.winnerId = null;
        this.history = [{
            timestamp: new Date(),
            action: 'match_created',
            details: { team1Id, team2Id }
        }];
        // Initialize roundStats with default values
        this.resetRoundStats();
    }

    // Helper method to reset roundStats to default values
    resetRoundStats() {
        this.roundStats = {
            team1: { won: 0, lost: 0 },
            team2: { won: 0, lost: 0 }
        };
    }

    // Helper method to safely get round stats
    getRoundStats() {
        if (!this.roundStats) {
            this.resetRoundStats();
        }
        if (!this.roundStats.team1 || !this.roundStats.team2) {
            this.resetRoundStats();
        }
        return this.roundStats;
    }

    // Add a new round
    addRound(team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score) {
        if (this.status !== 'in_progress') {
            throw new Error('Match must be in progress to add rounds');
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

        // Get current stats safely
        const stats = this.getRoundStats();
        
        // Update round statistics based on scores
        if (team1Score > team2Score) {
            stats.team1.won = (stats.team1.won || 0) + 1;
            stats.team2.lost = (stats.team2.lost || 0) + 1;
        } else if (team2Score > team1Score) {
            stats.team2.won = (stats.team2.won || 0) + 1;
            stats.team1.lost = (stats.team1.lost || 0) + 1;
        }

        // Add round data
        this.rounds.push({
            roundNumber: this.currentRound + 1,
            team1: { promise: team1Promise, actual: team1Actual, score: team1Score },
            team2: { promise: team2Promise, actual: team2Actual, score: team2Score }
        });

        // Update final scores
        this.finalScore = {
            team1: (this.finalScore?.team1 || 0) + team1Score,
            team2: (this.finalScore?.team2 || 0) + team2Score
        };

        // Check for winner
        if (this.finalScore.team1 >= 500 || this.finalScore.team2 >= 500) {
            this.complete();
        }

        this.currentRound++;

        // Add to history
        this.history.push({
            timestamp: new Date(),
            action: 'round_added',
            details: {
                roundNumber: this.currentRound,
                team1: { promise: team1Promise, actual: team1Actual, score: team1Score },
                team2: { promise: team2Promise, actual: team2Actual, score: team2Score }
            }
        });
    }

    // Start the match
    start() {
        if (this.status !== 'pending') {
            throw new Error('Match must be in pending status to start');
        }

        this.status = 'in_progress';
        this.history.push({
            timestamp: new Date(),
            action: 'match_started'
        });
    }

    // Complete the match
    complete() {
        if (this.status !== 'in_progress') {
            throw new Error('Match must be in progress to complete');
        }

        this.status = 'completed';
        
        // Determine winner
        if (this.finalScore.team1 >= 500) {
            this.winnerId = this.team1Id;
        } else if (this.finalScore.team2 >= 500) {
            this.winnerId = this.team2Id;
        } else {
            this.winnerId = null; // Draw
        }

        this.history.push({
            timestamp: new Date(),
            action: 'match_completed',
            details: {
                finalScore: this.finalScore,
                winnerId: this.winnerId
            }
        });
    }

    // Cancel the match
    cancel(reason) {
        if (this.status === 'completed') {
            throw new Error('Cannot cancel a completed match');
        }

        this.status = 'cancelled';
        this.history.push({
            timestamp: new Date(),
            action: 'match_cancelled',
            details: { reason }
        });
    }

    // Get match result for a specific team
    getResultForTeam(teamId) {
        if (this.status !== 'completed') {
            return null;
        }

        if (this.winnerId === teamId) {
            return 'win';
        } else if (this.winnerId === null) {
            return 'draw';
        } else {
            return 'loss';
        }
    }

    // Get match summary
    getSummary() {
        return {
            id: this.id,
            date: this.date,
            status: this.status,
            currentRound: this.currentRound,
            finalScore: this.finalScore,
            rounds: this.rounds,
            winnerId: this.winnerId
        };
    }

    // Convert match to JSON
    toJSON() {
        return {
            id: this.id,
            team1Id: this.team1Id,
            team2Id: this.team2Id,
            date: this.date,
            status: this.status,
            currentRound: this.currentRound,
            rounds: this.rounds,
            roundStats: this.roundStats,
            finalScore: this.finalScore,
            winnerId: this.winnerId,
            history: this.history
        };
    }

    // Create match from JSON
    static fromJSON(json) {
        const match = new Match(
            json.id,
            json.team1Id,
            json.team2Id,
            DateUtils.safeDate(json.date)
        );
        
        match.status = json.status || 'pending';
        match.currentRound = json.currentRound || 0;
        match.rounds = Array.isArray(json.rounds) ? json.rounds : [];
        
        // Reset roundStats to ensure proper structure
        match.resetRoundStats();
        
        // If we have valid roundStats in the JSON, update them
        if (json.roundStats && json.roundStats.team1 && json.roundStats.team2) {
            match.roundStats.team1.won = parseInt(json.roundStats.team1.won) || 0;
            match.roundStats.team1.lost = parseInt(json.roundStats.team1.lost) || 0;
            match.roundStats.team2.won = parseInt(json.roundStats.team2.won) || 0;
            match.roundStats.team2.lost = parseInt(json.roundStats.team2.lost) || 0;
        }
        
        match.finalScore = {
            team1: parseInt(json.finalScore?.team1) || 0,
            team2: parseInt(json.finalScore?.team2) || 0
        };
        match.winnerId = json.winnerId || null;
        match.history = Array.isArray(json.history) ? json.history.map(entry => ({
            ...entry,
            timestamp: DateUtils.safeDate(entry.timestamp)
        })) : [{
            timestamp: new Date(),
            action: 'match_created',
            details: {
                team1Id: json.team1Id,
                team2Id: json.team2Id
            }
        }];
        
        return match;
    }
} 