class TeamService {
    constructor(firebaseService) {
        this.firebaseService = firebaseService;
    }

    // Create a new team
    async createTeam(name, members) {
        if (!name || name.trim() === '') {
            throw new Error('Team name is required');
        }

        // Check if team name already exists
        const existingTeams = await this.firebaseService.getAllTeams();
        const existingTeam = existingTeams.find(team => team.name.toLowerCase() === name.toLowerCase());
        
        if (existingTeam) {
            throw new Error('A team with this name already exists');
        }

        const teamData = {
            name: name.trim(),
            members: members,
            createdAt: new Date(),
            stats: {
                matchesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                points: 0,
                totalScore: 0,
                roundsWon: 0,
                roundsLost: 0
            },
            matchHistory: []
        };

        return await this.firebaseService.createTeam(teamData);
    }

    // Get team details
    async getTeamDetails(teamId) {
        const team = await this.firebaseService.getTeam(teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        const allMatches = await this.firebaseService.getAllMatches();
        const teamMatches = allMatches.filter(match => match.team1Id === teamId || match.team2Id === teamId)
            .sort((a, b) => DateUtils.safeDate(b.date) - DateUtils.safeDate(a.date));

        const recentMatches = teamMatches.slice(0, 5).map(match => {
            return {
                ...match,
                result: this.getMatchResultForTeam(match, teamId)
            };
        });

        const recentForm = recentMatches.map(match => match.result);

        return {
            ...team,
            recentMatches,
            recentForm
        };
    }

    getMatchResultForTeam(match, teamId) {
        if (match.winnerId === null) {
            return 'draw';
        }
        return match.winnerId === teamId ? 'win' : 'loss';
    }

    async getHeadToHead(team1Id, team2Id) {
        const allMatches = await this.firebaseService.getAllMatches();
        const headToHeadMatches = allMatches.filter(match => 
            (match.team1Id === team1Id && match.team2Id === team2Id) ||
            (match.team1Id === team2Id && match.team2Id === team1Id)
        );

        const team1Stats = { wins: 0, losses: 0, draws: 0 };
        const team2Stats = { wins: 0, losses: 0, draws: 0 };

        headToHeadMatches.forEach(match => {
            const result = this.getMatchResultForTeam(match, team1Id);
            if (result === 'win') {
                team1Stats.wins++;
                team2Stats.losses++;
            } else if (result === 'loss') {
                team1Stats.losses++;
                team2Stats.wins++;
            } else {
                team1Stats.draws++;
                team2Stats.draws++;
            }
        });

        return {
            team1: team1Stats,
            team2: team2Stats,
            totalMatches: headToHeadMatches.length
        };
    }

    // Get all teams with their basic stats
    async getAllTeams() {
        return await this.firebaseService.getAllTeams();
    }

    // Get team rankings
    async getTeamRankings() {
        const teams = await this.firebaseService.getAllTeams();
        return teams.sort((a, b) => b.stats.points - a.stats.points);
    }
}

// Create a singleton instance - will be initialized in app.js
let teamService = null;

// Function to initialize the service
function initializeTeamService(firebaseService) {
    teamService = new TeamService(firebaseService);
    return teamService;
} 