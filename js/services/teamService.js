class TeamService {
    constructor(storage) {
        this.storage = storage;
    }

    // Create a new team
    createTeam(name) {
        if (!name || name.trim() === '') {
            throw new Error('Team name is required');
        }

        // Check if team name already exists
        const existingTeam = this.storage.getAllTeams()
            .find(team => team.name.toLowerCase() === name.toLowerCase());
        
        if (existingTeam) {
            throw new Error('A team with this name already exists');
        }

        return this.storage.addTeam(name.trim());
    }

    // Get team details
    getTeamDetails(teamId) {
        const team = this.storage.getTeam(teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        const matches = this.storage.getMatchesByTeam(teamId);
        const recentForm = team.getRecentForm();

        return {
            ...team.toJSON(),
            recentForm,
            recentMatches: matches
                .slice(-5)
                .reverse()
                .map(match => ({
                    ...match.getSummary(),
                    result: match.getResultForTeam(teamId)
                }))
        };
    }

    // Get all teams with their basic stats
    getAllTeams() {
        return this.storage.getAllTeams().map(team => {
            return {
                id: team.id,
                name: team.name,
                members: team.members,
                stats: team.stats,
                getWinRate: () => team.getWinRate()
            };
        });
    }

    // Get team rankings
    getTeamRankings() {
        return this.storage.getTeamRankings();
    }

    // Get head-to-head statistics between two teams
    getHeadToHead(team1Id, team2Id) {
        const team1 = this.storage.getTeam(team1Id);
        const team2 = this.storage.getTeam(team2Id);

        if (!team1 || !team2) {
            throw new Error('One or both teams not found');
        }

        const team1Stats = team1.getPerformanceAgainst(team2Id);
        const team2Stats = team2.getPerformanceAgainst(team1Id);

        return {
            team1: {
                id: team1Id,
                name: team1.name,
                ...team1Stats
            },
            team2: {
                id: team2Id,
                name: team2.name,
                ...team2Stats
            },
            totalMatches: team1Stats.played
        };
    }

    // Get team's match history
    getTeamHistory(teamId, limit = 10) {
        const team = this.storage.getTeam(teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        return team.matchHistory
            .slice(-limit)
            .reverse()
            .map(match => {
                const fullMatch = this.storage.getMatch(match.matchId);
                return {
                    ...match,
                    opponent: this.storage.getTeam(match.opponentId)?.name || 'Unknown Team'
                };
            });
    }

    // Get team's performance over time
    getTeamPerformanceOverTime(teamId) {
        const team = this.storage.getTeam(teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        const performance = [];
        let currentStats = {
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            points: 0
        };

        // Sort matches by date
        const sortedMatches = [...team.matchHistory]
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        sortedMatches.forEach(match => {
            if (match.result === 'win') {
                currentStats.wins++;
                currentStats.points += 3;
            } else if (match.result === 'loss') {
                currentStats.losses++;
            } else {
                currentStats.draws++;
                currentStats.points += 1;
            }
            currentStats.matchesPlayed++;

            performance.push({
                date: match.date,
                ...currentStats,
                winRate: (currentStats.wins / currentStats.matchesPlayed) * 100
            });
        });

        return performance;
    }

    // Search teams
    searchTeams(query) {
        if (!query) return this.getAllTeams();

        const searchTerm = query.toLowerCase();
        return this.storage.getAllTeams()
            .filter(team => team.name.toLowerCase().includes(searchTerm))
            .map(team => {
                const winRate = team.getWinRate();
                return {
                    id: team.id,
                    name: team.name,
                    members: team.members,
                    stats: team.stats,
                    winRate
                };
            });
    }
}

// Create a singleton instance
const teamService = new TeamService(storage); 