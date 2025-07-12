class Storage {
    constructor() {
        this.data = {
            teams: [],
            matches: [],
            lastTeamId: 0,
            lastMatchId: 0
        };
        this.authState = {
            isAuthenticated: false,
            authKey: 'redtoto'
        };
        console.log('Storage initialized with empty data');
        this.loadData();
        this.loadAuthState();
    }

    // Load data from localStorage
    loadData() {
        const savedData = localStorage.getItem('cardGameData');
        console.log('Raw data from localStorage:', savedData);
        if (savedData) {
            const parsed = JSON.parse(savedData);
            console.log('Parsed data from storage:', parsed);
            console.log('Teams before instantiation:', parsed.teams);
            console.log('Matches before instantiation:', parsed.matches);
            
            // Ensure matches have required properties
            if (parsed.matches) {
                parsed.matches = parsed.matches.map(match => {
                    if (!match.team1Id || !match.team2Id) {
                        console.warn('Match missing team IDs:', match);
                        // Try to recover team IDs from history if possible
                        const creationEntry = match.history?.find(entry => entry.action === 'match_created');
                        if (creationEntry?.details) {
                            match.team1Id = creationEntry.details.team1Id;
                            match.team2Id = creationEntry.details.team2Id;
                            console.log('Recovered team IDs from history:', match);
                        }
                    }
                    return match;
                });
            }
            
            this.data = {
                teams: parsed.teams.map(team => {
                    console.log('Creating team from:', team);
                    const teamInstance = Team.fromJSON(team);
                    console.log('Created team instance:', teamInstance, 'is Team instance:', teamInstance instanceof Team);
                    return teamInstance;
                }),
                matches: parsed.matches.map(match => {
                    console.log('Creating match from:', match);
                    const matchInstance = Match.fromJSON(match);
                    console.log('Created match instance:', matchInstance, 'is Match instance:', matchInstance instanceof Match);
                    return matchInstance;
                }),
                lastTeamId: parsed.lastTeamId,
                lastMatchId: parsed.lastMatchId
            };
            console.log('Final storage state:', this.data);
        } else {
            console.log('No saved data found in localStorage');
        }
    }

    // Load authentication state from localStorage
    loadAuthState() {
        const savedAuthState = localStorage.getItem('cardGameAuth');
        if (savedAuthState) {
            this.authState = JSON.parse(savedAuthState);
            console.log('Loaded auth state:', this.authState);
        }
    }

    // Save data to localStorage
    saveData() {
        const dataToSave = {
            teams: this.data.teams.map(team => team.toJSON()),
            matches: this.data.matches.map(match => match.toJSON()),
            lastTeamId: this.data.lastTeamId,
            lastMatchId: this.data.lastMatchId
        };
        console.log('Saving data to storage:', dataToSave);
        localStorage.setItem('cardGameData', JSON.stringify(dataToSave));
    }

    // Save authentication state to localStorage
    saveAuthState() {
        localStorage.setItem('cardGameAuth', JSON.stringify(this.authState));
        console.log('Saved auth state:', this.authState);
    }

    // Authentication methods
    isAuthenticated() {
        return this.authState.isAuthenticated;
    }

    authenticate(authKey) {
        if (authKey === this.authState.authKey) {
            this.authState.isAuthenticated = true;
            this.saveAuthState();
            return true;
        }
        return false;
    }

    // Team operations
    addTeam(name, members = []) {
        console.log('Adding new team:', { name, members });
        const team = new Team(++this.data.lastTeamId, name, members);
        console.log('Created team instance:', team, 'is Team instance:', team instanceof Team);
        this.data.teams.push(team);
        this.saveData();
        return team;
    }

    getTeam(id) {
        console.log('Getting team with id:', id);
        console.log('Available teams:', this.data.teams);
        const team = this.data.teams.find(team => team.id === id);
        console.log('Found team:', team);
        return team;
    }

    getAllTeams() {
        console.log('Current teams in storage:', this.data.teams);
        // Ensure each team is a Team instance
        const teams = this.data.teams.map(team => {
            console.log('Processing team:', team, 'is Team instance:', team instanceof Team);
            if (team instanceof Team) {
                return team;
            }
            const teamInstance = Team.fromJSON(team);
            console.log('Created new team instance:', teamInstance, 'is Team instance:', teamInstance instanceof Team);
            return teamInstance;
        });
        console.log('Returning teams:', teams);
        return teams;
    }

    updateTeam(team) {
        const index = this.data.teams.findIndex(t => t.id === team.id);
        if (index !== -1) {
            this.data.teams[index] = team;
            this.saveData();
            return true;
        }
        return false;
    }

    // Match operations
    addMatch(team1Id, team2Id) {
        console.log('Adding new match:', { team1Id, team2Id });
        const match = new Match(++this.data.lastMatchId, team1Id, team2Id);
        console.log('Created match instance:', match, 'is Match instance:', match instanceof Match);
        this.data.matches.push(match);
        this.saveData();
        return match;
    }

    getMatch(id) {
        return this.data.matches.find(match => match.id === id);
    }

    getAllMatches() {
        console.log('Current matches in storage:', this.data.matches);
        return this.data.matches.map(match => {
            console.log('Processing match:', match, 'is Match instance:', match instanceof Match);
            if (match instanceof Match) {
                return match;
            }
            const matchInstance = Match.fromJSON(match);
            console.log('Created new match instance:', matchInstance, 'is Match instance:', matchInstance instanceof Match);
            return matchInstance;
        });
    }

    getMatchesByTeam(teamId) {
        return this.data.matches.filter(match => 
            match.team1Id === teamId || match.team2Id === teamId
        );
    }

    updateMatch(match) {
        const index = this.data.matches.findIndex(m => m.id === match.id);
        if (index !== -1) {
            this.data.matches[index] = match;
            
            // Update team statistics if match is completed
            if (match.status === 'completed') {
                const team1 = this.getTeam(match.team1Id);
                const team2 = this.getTeam(match.team2Id);
                
                if (team1) team1.updateStats(match);
                if (team2) team2.updateStats(match);
            }
            
            this.saveData();
            return true;
        }
        return false;
    }

    // Statistics operations
    getTeamRankings() {
        return this.data.teams
            .map(team => ({
                id: team.id,
                name: team.name,
                points: team.stats.points,
                matchesPlayed: team.stats.matchesPlayed,
                wins: team.stats.wins,
                losses: team.stats.losses,
                draws: team.stats.draws,
                winRate: team.getWinRate()
            }))
            .sort((a, b) => {
                // Sort by points first, then by win rate
                if (b.points !== a.points) {
                    return b.points - a.points;
                }
                return b.winRate - a.winRate;
            });
    }

    getRecentActivity(limit = 10) {
        const allActivities = this.data.matches
            .flatMap(match => match.history.map(entry => ({
                ...entry,
                matchId: match.id,
                team1Id: match.team1Id,
                team2Id: match.team2Id
            })))
            .sort((a, b) => b.timestamp - a.timestamp);

        return allActivities.slice(0, limit);
    }

    // Data export/import
    exportData() {
        return JSON.stringify({
            teams: this.data.teams.map(team => team.toJSON()),
            matches: this.data.matches.map(match => match.toJSON()),
            lastTeamId: this.data.lastTeamId,
            lastMatchId: this.data.lastMatchId
        }, null, 2);
    }

    importData(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            this.data = {
                teams: data.teams.map(team => Team.fromJSON(team)),
                matches: data.matches.map(match => Match.fromJSON(match)),
                lastTeamId: data.lastTeamId,
                lastMatchId: data.lastMatchId
            };
            this.saveData();
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            return false;
        }
    }
}

// Create a singleton instance
const storage = new Storage(); 