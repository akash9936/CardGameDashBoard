// UI Elements
const elements = {
    // Navigation
    viewTeams: document.getElementById('viewTeams'),
    viewMatches: document.getElementById('viewMatches'),
    viewStats: document.getElementById('viewStats'),
    
    // Sections
    teamsSection: document.getElementById('teamsSection'),
    matchesSection: document.getElementById('matchesSection'),
    statsSection: document.getElementById('statsSection'),
    
    // Buttons
    addTeamBtn: document.getElementById('addTeamBtn'),
    addMatchBtn: document.getElementById('addMatchBtn'),
    
    // Lists
    teamsList: document.getElementById('teamsList'),
    matchesList: document.getElementById('matchesList'),
    teamRankings: document.getElementById('teamRankings'),
    recentActivity: document.getElementById('recentActivity'),
    
    // Modal
    modal: document.getElementById('modal'),
    modalContent: document.getElementById('modalContent'),
    closeBtn: document.querySelector('.close-btn')
};

// Navigation
elements.viewTeams.addEventListener('click', () => showSection('teams'));
elements.viewMatches.addEventListener('click', () => showSection('matches'));
elements.viewStats.addEventListener('click', () => showSection('stats'));

// Modal
elements.closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
    if (e.target === elements.modal) {
        closeModal();
    }
});

// Add Team Button
elements.addTeamBtn.addEventListener('click', () => {
    showModal(`
        <h2>Add New Team</h2>
        <form id="addTeamForm">
            <div class="form-group">
                <label for="teamName">Team Name</label>
                <input type="text" id="teamName" required>
            </div>
            <div class="form-group">
                <label for="teamMembers">Team Members (one per line)</label>
                <textarea id="teamMembers" rows="4" required></textarea>
            </div>
            <button type="submit" class="action-btn">Create Team</button>
        </form>
    `);

    document.getElementById('addTeamForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('teamName').value;
        const members = document.getElementById('teamMembers').value
            .split('\n')
            .map(m => m.trim())
            .filter(m => m.length > 0);
        
        try {
            teamService.createTeam(name, members);
            closeModal();
            refreshTeamsList();
            showNotification('Team created successfully!');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
});

// Add Match Button
elements.addMatchBtn.addEventListener('click', () => {
    const teams = teamService.getAllTeams();
    if (teams.length < 2) {
        showNotification('Need at least 2 teams to create a match', 'error');
        return;
    }

    showModal(`
        <h2>Create New Match</h2>
        <form id="addMatchForm">
            <div class="form-group">
                <label for="team1">Team 1</label>
                <select id="team1" required>
                    <option value="">Select Team 1</option>
                    ${teams.map(team => `
                        <option value="${team.id}">${team.name}</option>
                    `).join('')}
                </select>
                <div id="team1Members" class="team-members"></div>
            </div>
            <div class="form-group">
                <label for="team2">Team 2</label>
                <select id="team2" required>
                    <option value="">Select Team 2</option>
                    ${teams.map(team => `
                        <option value="${team.id}">${team.name}</option>
                    `).join('')}
                </select>
                <div id="team2Members" class="team-members"></div>
            </div>
            <button type="submit" class="action-btn">Start Match</button>
        </form>
    `);

    // Show team members when team is selected
    const team1Select = document.getElementById('team1');
    const team2Select = document.getElementById('team2');
    const team1Members = document.getElementById('team1Members');
    const team2Members = document.getElementById('team2Members');

    function updateTeamMembers(select, membersDiv) {
        const teamId = select.value;
        if (teamId) {
            const team = teamService.getTeamDetails(teamId);
            membersDiv.innerHTML = `
                <h4>Team Members:</h4>
                <ul>
                    ${team.members.map(member => `<li>${member}</li>`).join('')}
                </ul>
            `;
        } else {
            membersDiv.innerHTML = '';
        }
    }

    team1Select.addEventListener('change', () => {
        updateTeamMembers(team1Select, team1Members);
        if (team1Select.value === team2Select.value) {
            team2Select.value = '';
            team2Members.innerHTML = '';
        }
    });

    team2Select.addEventListener('change', () => {
        updateTeamMembers(team2Select, team2Members);
        if (team2Select.value === team1Select.value) {
            team1Select.value = '';
            team1Members.innerHTML = '';
        }
    });

    document.getElementById('addMatchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const team1Id = parseInt(document.getElementById('team1').value);
        const team2Id = parseInt(document.getElementById('team2').value);
        
        if (!team1Id || !team2Id) {
            showNotification('Please select both teams', 'error');
            return;
        }

        if (team1Id === team2Id) {
            showNotification('A team cannot play against itself', 'error');
            return;
        }
        
        try {
            const match = matchService.createMatch(team1Id, team2Id);
            matchService.startMatch(match.id);
            closeModal();
            showMatchRoundModal(match.id);
            refreshMatchesList();
            showNotification('Match started successfully!');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
});

// Show match round modal
function showMatchRoundModal(matchId) {
    try {
        const matchDetails = matchService.getMatchDetails(matchId);
        if (!matchDetails) {
            throw new Error('Match not found');
        }

        const { teams } = matchDetails;
        if (!teams || !teams.team1 || !teams.team2) {
            throw new Error('Match team details not found');
        }

        showModal(`
            <h2>Round ${matchDetails.currentRound + 1}</h2>
            <div class="match-status">
                <div class="team-score">
                    <h3>${teams.team1.name}</h3>
                    <p>Current Score: ${matchDetails.finalScore.team1}</p>
                </div>
                <div class="team-score">
                    <h3>${teams.team2.name}</h3>
                    <p>Current Score: ${matchDetails.finalScore.team2}</p>
                </div>
            </div>
            <form id="roundForm">
                <div class="round-inputs">
                    <div class="team-inputs">
                        <h4>${teams.team1.name}</h4>
                        <div class="form-group">
                            <label for="team1Promise">Promise Hand</label>
                            <input type="number" id="team1Promise" min="0" required>
                        </div>
                        <div class="form-group">
                            <label for="team1Actual">Actual Hand</label>
                            <input type="number" id="team1Actual" min="0" required>
                        </div>
                    </div>
                    <div class="team-inputs">
                        <h4>${teams.team2.name}</h4>
                        <div class="form-group">
                            <label for="team2Promise">Promise Hand</label>
                            <input type="number" id="team2Promise" min="0" required>
                        </div>
                        <div class="form-group">
                            <label for="team2Actual">Actual Hand</label>
                            <input type="number" id="team2Actual" min="0" required>
                        </div>
                    </div>
                </div>
                <button type="submit" class="action-btn">Submit Round</button>
            </form>
            ${matchDetails.currentRound > 0 ? `
                <div class="round-history">
                    <h3>Round History</h3>
                    ${matchDetails.rounds.slice(0, -1).map(round => `
                        <div class="round-item">
                            <h4>Round ${round.roundNumber}</h4>
                            <div class="round-scores">
                                <div class="team-round">
                                    <strong>${teams.team1.name}:</strong>
                                    Promise: ${round.team1.promise}, 
                                    Actual: ${round.team1.actual}, 
                                    Score: ${round.team1.score}
                                </div>
                                <div class="team-round">
                                    <strong>${teams.team2.name}:</strong>
                                    Promise: ${round.team2.promise}, 
                                    Actual: ${round.team2.actual}, 
                                    Score: ${round.team2.score}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `);

        document.getElementById('roundForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const team1Promise = parseInt(document.getElementById('team1Promise').value);
            const team1Actual = parseInt(document.getElementById('team1Actual').value);
            const team2Promise = parseInt(document.getElementById('team2Promise').value);
            const team2Actual = parseInt(document.getElementById('team2Actual').value);

            try {
                matchService.addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual);
                const updatedMatch = matchService.getMatchDetails(matchId);
                
                if (updatedMatch.status === 'completed') {
                    closeModal();
                    refreshMatchesList();
                    refreshStats();
                    showNotification('Match completed!');
                } else {
                    showMatchRoundModal(matchId);
                }
            } catch (error) {
                showNotification(error.message, 'error');
            }
        });
    } catch (error) {
        showNotification(error.message, 'error');
        closeModal();
    }
}

// Helper Functions
function showSection(section) {
    // Update navigation buttons
    elements.viewTeams.classList.toggle('active', section === 'teams');
    elements.viewMatches.classList.toggle('active', section === 'matches');
    elements.viewStats.classList.toggle('active', section === 'stats');

    // Show selected section
    elements.teamsSection.classList.toggle('active', section === 'teams');
    elements.matchesSection.classList.toggle('active', section === 'matches');
    elements.statsSection.classList.toggle('active', section === 'stats');

    // Refresh content
    switch (section) {
        case 'teams':
            refreshTeamsList();
            break;
        case 'matches':
            refreshMatchesList();
            break;
        case 'stats':
            refreshStats();
            break;
    }
}

function showModal(content) {
    elements.modalContent.innerHTML = content;
    elements.modal.style.display = 'block';
}

function closeModal() {
    elements.modal.style.display = 'none';
    elements.modalContent.innerHTML = '';
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Refresh Functions
function refreshTeamsList() {
    const teams = teamService.getAllTeams();
    elements.teamsList.innerHTML = teams.map(team => `
        <div class="card team-card">
            <h3>${team.name}</h3>
            <div class="team-members">
                ${team.members.map(member => `<span class="member">${member}</span>`).join('')}
            </div>
            <div class="team-stats">
                <p>Matches: ${team.stats.matchesPlayed}</p>
                <p>Wins: ${team.stats.wins}</p>
                <p>Losses: ${team.stats.losses}</p>
                <p>Draws: ${team.stats.draws}</p>
                <p>Points: ${team.stats.points}</p>
                <p>Total Score: ${team.stats.totalScore}</p>
                <p>Rounds Won: ${team.stats.roundsWon}</p>
                <p>Rounds Lost: ${team.stats.roundsLost}</p>
                <p>Win Rate: ${team.getWinRate().toFixed(1)}%</p>
            </div>
            <button onclick="viewTeamDetails(${team.id})" class="action-btn">View Details</button>
        </div>
    `).join('');
}

function refreshMatchesList() {
    const matches = matchService.getAllMatches();
    const teams = teamService.getAllTeams();
    console.log('Available teams:', teams);
    
    if (teams.length === 0) {
        elements.matchesList.innerHTML = '<div class="notification error">No teams found. Please create teams first.</div>';
        return;
    }

    elements.matchesList.innerHTML = matches.map(match => {
        console.log('Processing match:', match);
        const team1 = storage.getTeam(match.team1Id);
        const team2 = storage.getTeam(match.team2Id);
        
        if (!team1 || !team2) {
            console.error(`Team not found for match ${match.id}: team1=${match.team1Id} (${team1 ? 'found' : 'not found'}), team2=${match.team2Id} (${team2 ? 'found' : 'not found'})`);
            return ''; // Skip this match if teams are not found
        }

        // Get match status and score information
        const status = match.status || 'pending';
        const finalScore = match.finalScore || { team1: 0, team2: 0 };
        const rounds = Array.isArray(match.rounds) ? match.rounds : [];
        const currentRound = match.currentRound || 0;
        
        return `
            <div class="card match-card">
                <div class="match-header">
                    <span class="match-date">${new Date(match.date).toLocaleDateString()}</span>
                    <span class="match-status ${status}">${status}</span>
                </div>
                <div class="match-teams">
                    <div class="team ${match.winnerId === match.team1Id ? 'winner' : ''}">
                        <h3>${team1.name}</h3>
                        <div class="team-members">
                            ${team1.members.map(member => `<span class="member">${member}</span>`).join('')}
                        </div>
                        <span class="score">${finalScore.team1}</span>
                    </div>
                    <div class="team ${match.winnerId === match.team2Id ? 'winner' : ''}">
                        <h3>${team2.name}</h3>
                        <div class="team-members">
                            ${team2.members.map(member => `<span class="member">${member}</span>`).join('')}
                        </div>
                        <span class="score">${finalScore.team2}</span>
                    </div>
                </div>
                ${status === 'pending' ? `
                    <div class="match-actions">
                        <button onclick="startMatch(${match.id})" class="action-btn">Start Match</button>
                        <button onclick="cancelMatch(${match.id})" class="action-btn danger">Cancel</button>
                    </div>
                ` : ''}
                ${status === 'in_progress' ? `
                    <div class="match-round-input">
                        <h4>Round ${currentRound + 1}</h4>
                        <form onsubmit="submitRound(event, ${match.id})" class="round-form">
                            <div class="round-inputs">
                                <div class="team-inputs">
                                    <h5>${team1.name}</h5>
                                    <div class="form-group">
                                        <label for="team1Promise${match.id}">Promise Hand</label>
                                        <input type="number" id="team1Promise${match.id}" min="0" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="team1Actual${match.id}">Actual Hand</label>
                                        <input type="number" id="team1Actual${match.id}" min="0" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="team1Score${match.id}">Score</label>
                                        <input type="number" id="team1Score${match.id}" required>
                                    </div>
                                </div>
                                <div class="team-inputs">
                                    <h5>${team2.name}</h5>
                                    <div class="form-group">
                                        <label for="team2Promise${match.id}">Promise Hand</label>
                                        <input type="number" id="team2Promise${match.id}" min="0" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="team2Actual${match.id}">Actual Hand</label>
                                        <input type="number" id="team2Actual${match.id}" min="0" required>
                                    </div>
                                    <div class="form-group">
                                        <label for="team2Score${match.id}">Score</label>
                                        <input type="number" id="team2Score${match.id}" required>
                                    </div>
                                </div>
                            </div>
                            <button type="submit" class="action-btn">Submit Round</button>
                            <button type="button" onclick="cancelMatch(${match.id})" class="action-btn danger">Cancel Match</button>
                        </form>
                    </div>
                ` : ''}
                ${rounds.length > 0 ? `
                    <div class="match-rounds">
                        <h4>Round History</h4>
                        <div class="rounds-list">
                            ${rounds.map(round => `
                                <div class="round-item">
                                    <h5>Round ${round.roundNumber}</h5>
                                    <div class="round-scores">
                                        <div class="team-round">
                                            <strong>${team1.name}:</strong>
                                            Promise: ${round.team1.promise}, 
                                            Actual: ${round.team1.actual}, 
                                            Score: ${round.team1.score}
                                        </div>
                                        <div class="team-round">
                                            <strong>${team2.name}:</strong>
                                            Promise: ${round.team2.promise}, 
                                            Actual: ${round.team2.actual}, 
                                            Score: ${round.team2.score}
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${status === 'cancelled' ? `
                    <div class="match-summary">
                        <p class="cancelled-message">Match was cancelled</p>
                        ${match.history?.find(h => h.action === 'match_cancelled')?.details?.reason ? 
                            `<p class="cancellation-reason">Reason: ${match.history.find(h => h.action === 'match_cancelled').details.reason}</p>` 
                            : ''}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function refreshStats() {
    // Update team rankings
    const rankings = teamService.getTeamRankings();
    elements.teamRankings.innerHTML = rankings.map((team, index) => `
        <div class="ranking-item">
            <span class="rank">#${index + 1}</span>
            <span class="team-name">${team.name}</span>
            <span class="points">${team.points} pts</span>
            <span class="win-rate">${team.winRate.toFixed(1)}%</span>
        </div>
    `).join('');

    // Update recent activity
    const activities = storage.getRecentActivity();
    elements.recentActivity.innerHTML = activities.map(activity => `
        <div class="activity-item">
            <span class="activity-time">${new Date(activity.timestamp).toLocaleString()}</span>
            <span class="activity-action">${formatActivity(activity)}</span>
        </div>
    `).join('');
}

function viewTeamDetails(teamId) {
    const team = teamService.getTeamDetails(teamId);
    const headToHead = teamService.getHeadToHead(teamId, team.recentMatches[0]?.opponentId);
    
    showModal(`
        <h2>${team.name} Details</h2>
        <div class="team-details">
            <div class="stats-grid">
                <div class="stat-item">
                    <h4>Overall Stats</h4>
                    <p>Matches: ${team.stats.matchesPlayed}</p>
                    <p>Wins: ${team.stats.wins}</p>
                    <p>Losses: ${team.stats.losses}</p>
                    <p>Draws: ${team.stats.draws}</p>
                    <p>Points: ${team.stats.points}</p>
                    <p>Win Rate: ${team.getWinRate().toFixed(1)}%</p>
                </div>
                <div class="stat-item">
                    <h4>Recent Form</h4>
                    <div class="form-indicators">
                        ${team.recentForm.map(result => `
                            <span class="form-indicator ${result}">${result[0].toUpperCase()}</span>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="recent-matches">
                <h4>Recent Matches</h4>
                ${team.recentMatches.map(match => `
                    <div class="match-item">
                        <span class="match-date">${new Date(match.date).toLocaleDateString()}</span>
                        <span class="match-result ${match.result}">${match.result.toUpperCase()}</span>
                        <span class="match-score">${match.score.team1} - ${match.score.team2}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `);
}

function formatActivity(activity) {
    const match = storage.getMatch(activity.matchId);
    if (!match) return 'Unknown activity';

    const team1 = storage.getTeam(match.team1Id);
    const team2 = storage.getTeam(match.team2Id);
    if (!team1 || !team2) return 'Unknown activity';

    switch (activity.action) {
        case 'match_created':
            return `New match created: ${team1.name} vs ${team2.name}`;
        case 'round_added':
            return `Round ${activity.details.roundNumber} added: ${team1.name} ${activity.details.team1.score} - ${activity.details.team2.score} ${team2.name}`;
        case 'match_completed':
            return `Match completed: ${team1.name} ${match.finalScore.team1} - ${match.finalScore.team2} ${team2.name}`;
        case 'match_cancelled':
            return `Match cancelled: ${team1.name} vs ${team2.name}${activity.details.reason ? ` (${activity.details.reason})` : ''}`;
        case 'match_started':
            return `Match started: ${team1.name} vs ${team2.name}`;
        default:
            return 'Unknown activity';
    }
}

// Update submitRound function to handle scores
function submitRound(event, matchId) {
    event.preventDefault();
    
    // Get match details to access team information
    const matchDetails = matchService.getMatchDetails(matchId);
    if (!matchDetails) {
        showNotification('Match not found', 'error');
        return;
    }

    const team1Promise = parseInt(document.getElementById(`team1Promise${matchId}`).value);
    const team1Actual = parseInt(document.getElementById(`team1Actual${matchId}`).value);
    const team1Score = parseInt(document.getElementById(`team1Score${matchId}`).value);
    const team2Promise = parseInt(document.getElementById(`team2Promise${matchId}`).value);
    const team2Actual = parseInt(document.getElementById(`team2Actual${matchId}`).value);
    const team2Score = parseInt(document.getElementById(`team2Score${matchId}`).value);

    // Validate inputs
    if (isNaN(team1Promise) || isNaN(team1Actual) || isNaN(team2Promise) || isNaN(team2Actual) || 
        isNaN(team1Score) || isNaN(team2Score)) {
        showNotification('Please enter valid numbers for all fields', 'error');
        return;
    }

    try {
        matchService.addRound(
            matchId,
            team1Promise,
            team1Actual,
            team2Promise,
            team2Actual,
            team1Score,  // Use the manually entered score
            team2Score   // Use the manually entered score
        );
        refreshMatchesList();
        refreshStats();
        showNotification('Round added successfully!');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Update startMatch function to not show modal
function startMatch(matchId) {
    try {
        matchService.startMatch(matchId);
        refreshMatchesList();
        showNotification('Match started successfully!');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Add cancelMatch function if not already present
function cancelMatch(matchId) {
    const reason = prompt('Please enter reason for cancellation:');
    if (reason === null) return; // User cancelled the prompt
    
    try {
        matchService.cancelMatch(matchId, reason);
        refreshMatchesList();
        showNotification('Match cancelled successfully');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    showSection('teams');
});