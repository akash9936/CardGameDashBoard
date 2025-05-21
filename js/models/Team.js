class Team {
    constructor(id, name, members = [], createdAt = new Date()) {
        this.id = id;
        this.name = name;
        this.members = members; // Array of team member names
        this.createdAt = createdAt;
        this.stats = {
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            points: 0,
            totalScore: 0, // Total score across all matches
            roundsWon: 0,  // Number of rounds won
            roundsLost: 0  // Number of rounds lost
        };
        this.matchHistory = [];
    }

    // Update team statistics after a match
    updateStats(match) {
        this.stats.matchesPlayed++;
        
        // Update match result
        if (match.winnerId === this.id) {
            this.stats.wins++;
            this.stats.points += 3;
        } else if (match.winnerId === null) {
            this.stats.draws++;
            this.stats.points += 1;
        } else {
            this.stats.losses++;
        }

        // Update score statistics
        const teamScore = match.team1Id === this.id ? match.finalScore.team1 : match.finalScore.team2;
        this.stats.totalScore += teamScore;

        // Update round statistics from roundStats
        const teamStats = match.team1Id === this.id ? match.roundStats.team1 : match.roundStats.team2;
        if (teamStats) {
            this.stats.roundsWon += teamStats.won || 0;
            this.stats.roundsLost += teamStats.lost || 0;
        }

        // Add to match history
        this.matchHistory.push({
            matchId: match.id,
            opponentId: match.team1Id === this.id ? match.team2Id : match.team1Id,
            result: match.winnerId === this.id ? 'win' : 
                   match.winnerId === null ? 'draw' : 'loss',
            date: match.date,
            score: teamScore,
            rounds: {
                won: teamStats?.won || 0,
                lost: teamStats?.lost || 0
            }
        });
    }

    // Get team's win rate
    getWinRate() {
        if (this.stats.matchesPlayed === 0) return 0;
        return (this.stats.wins / this.stats.matchesPlayed) * 100;
    }

    // Get team's form (last 5 matches)
    getRecentForm() {
        return this.matchHistory
            .slice(-5)
            .reverse()
            .map(match => match.result);
    }

    // Get team's performance against a specific opponent
    getPerformanceAgainst(opponentId) {
        const matches = this.matchHistory.filter(match => match.opponentId === opponentId);
        return {
            played: matches.length,
            wins: matches.filter(match => match.result === 'win').length,
            losses: matches.filter(match => match.result === 'loss').length,
            draws: matches.filter(match => match.result === 'draw').length,
            totalScore: matches.reduce((sum, match) => sum + match.score, 0)
        };
    }

    // Convert team to JSON
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            members: this.members,
            createdAt: this.createdAt,
            stats: this.stats,
            matchHistory: this.matchHistory
        };
    }

    // Create team from JSON
    static fromJSON(json) {
        const team = new Team(json.id, json.name, json.members, new Date(json.createdAt));
        team.stats = json.stats;
        team.matchHistory = json.matchHistory;
        return team;
    }
} 