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
    recalculateStatsBtn: document.getElementById('recalculateStatsBtn'),
    fixStatsBtn: document.getElementById('fixStatsBtn'),
    
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

// Recalculate Stats Button
elements.recalculateStatsBtn.addEventListener('click', recalculateStats);

// Fix Stats Button
elements.fixStatsBtn.addEventListener('click', recalculateStats);

// Modal
elements.closeBtn.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
    if (e.target === elements.modal) {
        closeModal();
    }
});

// Add Team Button
elements.addTeamBtn.addEventListener('click', () => {
    // Check if user is already authenticated
    if (storage.isAuthenticated()) {
        showAddTeamModal();
    } else {
        showAuthModal();
    }
});

// Show authentication modal
function showAuthModal(context = 'team') {
    elements.modal.classList.add('auth-modal');
    elements.modal.setAttribute('data-context', context);
    
    const contextMessages = {
        'team': 'You need to enter the authentication key to add teams.',
        'match': 'You need to enter the authentication key to create matches.',
        'round': 'You need to enter the authentication key to submit rounds.',
        'cancel': 'You need to enter the authentication key to cancel matches.',
        'start': 'You need to enter the authentication key to start matches.'
    };
    
    const contextActions = {
        'team': () => showAddTeamModal(),
        'match': () => showAddMatchModal(),
        'round': () => window.pendingRoundAction && window.pendingRoundAction(),
        'cancel': () => window.pendingCancelAction && window.pendingCancelAction(),
        'start': () => window.pendingStartAction && window.pendingStartAction()
    };
    
    showModal(`
        <h2>🔐 Authentication Required</h2>
        <p style="color: var(--text-muted); margin-bottom: 20px;">
            ${contextMessages[context]}
        </p>
        <form id="authForm">
            <div class="form-group">
                <label for="authKey">Authentication Key</label>
                <input type="password" id="authKey" required placeholder="Enter authentication key">
            </div>
            <button type="submit" class="action-btn">Authenticate</button>
        </form>
    `);

    document.getElementById('authForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const authKey = document.getElementById('authKey').value;
        
        if (storage.authenticate(authKey)) {
            closeModal();
            showNotification('Authentication successful!', 'success');
            const action = contextActions[context];
            if (action) {
                action();
            }
        } else {
            showNotification('Invalid authentication key. Please try again.', 'error');
            document.getElementById('authKey').value = '';
            document.getElementById('authKey').focus();
        }
    });
}

// Show add team modal
function showAddTeamModal() {
    elements.modal.classList.remove('auth-modal');
    elements.modal.removeAttribute('data-context');
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

    document.getElementById('addTeamForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('teamName').value;
        const members = document.getElementById('teamMembers').value
            .split('\n')
            .map(m => m.trim())
            .filter(m => m.length > 0);
        
        try {
            await teamService.createTeam(name, members);
            closeModal();
            await refreshTeamsList();
            showNotification('Team created successfully!');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}

// Add Match Button
elements.addMatchBtn.addEventListener('click', async () => {
    // Check if user is already authenticated
    if (storage.isAuthenticated()) {
        showAddMatchModal();
    } else {
        showAuthModal('match');
    }
});

// Show add match modal
async function showAddMatchModal() {
    const teams = await teamService.getAllTeams();
    if (teams.length < 2) {
        showNotification('Need at least 2 teams to create a match', 'error');
        return;
    }

    elements.modal.classList.remove('auth-modal');
    elements.modal.removeAttribute('data-context');
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

    async function updateTeamMembers(select, membersDiv) {
        const teamId = select.value;
        if (teamId) {
            const team = await teamService.getTeamDetails(teamId);
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

    document.getElementById('addMatchForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const team1Id = document.getElementById('team1').value;
        const team2Id = document.getElementById('team2').value;
        
        if (!team1Id || !team2Id) {
            showNotification('Please select both teams', 'error');
            return;
        }

        if (team1Id === team2Id) {
            showNotification('A team cannot play against itself', 'error');
            return;
        }
        
        try {
            const match = await matchService.createMatch(team1Id, team2Id);
            await matchService.startMatch(match.id);
            closeModal();
            await refreshMatchesList();
            showNotification('Match started successfully!');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}

// Show match round modal
async function showMatchRoundModal(matchId) {
    try {
        const matchDetails = await matchService.getMatchDetails(matchId);
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

        document.getElementById('roundForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Check if user is authenticated
            if (!storage.isAuthenticated()) {
                // Store the action to execute after authentication
                window.pendingRoundAction = () => {
                    const team1Promise = parseInt(document.getElementById('team1Promise').value);
                    const team1Actual = parseInt(document.getElementById('team1Actual').value);
                    const team2Promise = parseInt(document.getElementById('team2Promise').value);
                    const team2Actual = parseInt(document.getElementById('team2Actual').value);
                    
                    // Calculate scores based on promise vs actual
                    const team1Score = Math.abs(team1Promise - team1Actual) * 10;
                    const team2Score = Math.abs(team2Promise - team2Actual) * 10;
                    
                    matchService.addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score)
                        .then(async () => {
                            const updatedMatch = await matchService.getMatchDetails(matchId);
                            
                            if (updatedMatch.status === 'completed') {
                                closeModal();
                                await refreshMatchesList();
                                await refreshStats();
                                showNotification('Match completed!');
                            } else {
                                await showMatchRoundModal(matchId);
                            }
                        })
                        .catch(error => {
                            showNotification(error.message, 'error');
                        });
                };
                showAuthModal('round');
                return;
            }
            
            const team1Promise = parseInt(document.getElementById('team1Promise').value);
            const team1Actual = parseInt(document.getElementById('team1Actual').value);
            const team2Promise = parseInt(document.getElementById('team2Promise').value);
            const team2Actual = parseInt(document.getElementById('team2Actual').value);

            try {
                // Calculate scores based on promise vs actual
                const team1Score = Math.abs(team1Promise - team1Actual) * 10;
                const team2Score = Math.abs(team2Promise - team2Actual) * 10;
                
                await matchService.addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score);
                const updatedMatch = await matchService.getMatchDetails(matchId);
                
                if (updatedMatch.status === 'completed') {
                    closeModal();
                    await refreshMatchesList();
                    await refreshStats();
                    showNotification('Match completed!');
                } else {
                    await showMatchRoundModal(matchId);
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
    elements.modal.classList.remove('auth-modal');
    elements.modal.removeAttribute('data-context');
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
async function refreshTeamsList() {
    const teams = await teamService.getAllTeams();
    console.log('Teams retrieved:', teams);
    
    elements.teamsList.innerHTML = teams.map(team => {
        // Ensure stats object exists and has default values
        const stats = team.stats || {
            matchesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            points: 0,
            totalScore: 0,
            roundsWon: 0,
            roundsLost: 0
        };
        
        console.log(`Team ${team.name} stats:`, stats);
        
        return `
            <div class="card team-card">
                <h3>${team.name}</h3>
                <div class="team-members">
                    ${team.members.map(member => `<span class="member">${member}</span>`).join('')}
                </div>
                <div class="team-stats">
                    <p>Matches: ${stats.matchesPlayed}</p>
                    <p>Wins: ${stats.wins}</p>
                    <p>Losses: ${stats.losses}</p>
                    <p>Draws: ${stats.draws}</p>
                    <p>Points: ${stats.points}</p>
                    <p>Total Score: ${stats.totalScore}</p>
                    <p>Rounds Won: ${stats.roundsWon}</p>
                    <p>Rounds Lost: ${stats.roundsLost}</p>
                    <p>Win Rate: ${((stats.wins / stats.matchesPlayed) * 100 || 0).toFixed(1)}%</p>
                </div>
                <button onclick="viewTeamDetails('${team.id}')" class="action-btn">View Details</button>
            </div>
        `;
    }).join('');
}

async function refreshMatchesList() {
    const matches = await matchService.getAllMatches();
    const teams = await teamService.getAllTeams();
    
    if (teams.length === 0) {
        elements.matchesList.innerHTML = '<div class="notification error">No teams found. Please create teams first.</div>';
        return;
    }

    elements.matchesList.innerHTML = matches.map(match => {
        const team1 = teams.find(t => t.id === match.team1Id);
        const team2 = teams.find(t => t.id === match.team2Id);
        
        if (!team1 || !team2) {
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
                    <span class="match-date">${DateUtils.formatDate(match.date)}</span>
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
                        <button onclick="startMatch('${match.id}')" class="action-btn">Start Match</button>
                        <button onclick="cancelMatch('${match.id}')" class="action-btn danger">Cancel</button>
                    </div>
                ` : ''}
                ${status === 'in_progress' ? `
                    <div class="match-round-input">
                        <h4>Round ${currentRound + 1}</h4>
                        <form onsubmit="submitRound(event, '${match.id}')" class="round-form">
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
                            <button type="button" onclick="cancelMatch('${match.id}')" class="action-btn danger">Cancel Match</button>
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

async function refreshStats() {
    // Update team rankings
    const rankings = await teamService.getTeamRankings();
    elements.teamRankings.innerHTML = rankings.map((team, index) => `
        <div class="ranking-item">
            <span class="rank">#${index + 1}</span>
            <span class="team-name">${team.name}</span>
            <span class="points">${team.stats.points} pts</span>
            <span class="win-rate">${((team.stats.wins / team.stats.matchesPlayed) * 100 || 0).toFixed(1)}%</span>
        </div>
    `).join('');
    
    // Update recent activity
    const recentMatches = await matchService.getRecentMatches();
    const teams = await teamService.getAllTeams();
    elements.recentActivity.innerHTML = recentMatches.map(match => {
        const team1 = teams.find(t => t.id === match.team1Id);
        const team2 = teams.find(t => t.id === match.team2Id);
        if (!team1 || !team2) return '';
        
        let activity = '';
        switch (match.status) {
            case 'completed':
                activity = `Match completed: ${team1.name} ${match.finalScore.team1} - ${match.finalScore.team2} ${team2.name}`;
                break;
            case 'cancelled':
                activity = `Match cancelled: ${team1.name} vs ${team2.name}`;
                break;
            default:
                activity = `Match started: ${team1.name} vs ${team2.name}`;
        }
        
        return `
            <div class="activity-item">
                <span class="activity-time">${DateUtils.formatDateTime(match.date)}</span>
                <span class="activity-action">${activity}</span>
            </div>
        `;
    }).join('');
}

async function viewTeamDetails(teamId) {
    const team = await teamService.getTeamDetails(teamId);
    const opponentId = team.recentMatches[0]?.opponentId;
    let headToHeadHTML = '';
    if (opponentId) {
        const headToHead = await teamService.getHeadToHead(teamId, opponentId);
        const opponent = await teamService.getTeamDetails(opponentId);
        headToHeadHTML = `
            <div class="stat-item">
                <h4>Head-to-Head vs ${opponent.name}</h4>
                <p>Matches: ${headToHead.totalMatches}</p>
                <p>Wins: ${headToHead.team1.wins}</p>
                <p>Losses: ${headToHead.team1.losses}</p>
                <p>Draws: ${headToHead.team1.draws}</p>
            </div>
        `;
    }
    
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
                    <p>Win Rate: ${((team.stats.wins / team.stats.matchesPlayed) * 100 || 0).toFixed(1)}%</p>
                </div>
                <div class="stat-item">
                    <h4>Recent Form</h4>
                    <div class="form-indicators">
                        ${team.recentForm.map(result => `
                            <span class="form-indicator ${result}">${result[0].toUpperCase()}</span>
                        `).join('')}
                    </div>
                </div>
                ${headToHeadHTML}
            </div>
            <div class="recent-matches">
                <h4>Recent Matches</h4>
                ${team.recentMatches.map(match => `
                    <div class="match-item">
                        <span class="match-date">${DateUtils.formatDate(match.date)}</span>
                        <span class="match-result ${match.result}">${match.result.toUpperCase()}</span>
                        <span class="match-score">${match.finalScore.team1} - ${match.finalScore.team2}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `);
}

async function formatActivity(activity) {
    const match = await matchService.getMatchDetails(activity.matchId);
    if (!match) return 'Unknown activity';

    const team1 = await teamService.getTeamDetails(match.team1Id);
    const team2 = await teamService.getTeamDetails(match.team2Id);
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

// Update submitRound function to handle scores with authentication
async function submitRound(event, matchId) {
    event.preventDefault();
    
    // Check if user is authenticated
    if (!storage.isAuthenticated()) {
        // Store the action to execute after authentication
        window.pendingRoundAction = () => submitRound(event, matchId);
        showAuthModal('round');
        return;
    }
    
    // Get match details to access team information
    const matchDetails = await matchService.getMatchDetails(matchId);
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
        await matchService.addRound(
            matchId,
            team1Promise,
            team1Actual,
            team2Promise,
            team2Actual,
            team1Score,  // Use the manually entered score
            team2Score   // Use the manually entered score
        );
        await refreshMatchesList();
        await refreshStats();
        showNotification('Round added successfully!');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Update startMatch function with authentication
async function startMatch(matchId) {
    // Check if user is authenticated
    if (!storage.isAuthenticated()) {
        // Store the action to execute after authentication
        window.pendingStartAction = () => startMatch(matchId);
        showAuthModal('start');
        return;
    }
    
    try {
        await matchService.startMatch(matchId);
        await refreshMatchesList();
        showNotification('Match started successfully!');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Add cancelMatch function with authentication
async function cancelMatch(matchId) {
    // Check if user is authenticated
    if (!storage.isAuthenticated()) {
        // Store the action to execute after authentication
        window.pendingCancelAction = () => cancelMatch(matchId);
        showAuthModal('cancel');
        return;
    }
    
    const reason = prompt('Please enter reason for cancellation:');
    if (reason === null) return; // User cancelled the prompt
    
    try {
        await matchService.cancelMatch(matchId, reason);
        await refreshMatchesList();
        showNotification('Match cancelled successfully');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

async function recalculateStats() {
    try {
        showNotification('Recalculating team statistics...', 'info');
        console.log('Starting stats recalculation...');
        
        // Get current data for debugging
        const teams = await teamService.getAllTeams();
        const matches = await matchService.getAllMatches();
        console.log(`Found ${teams.length} teams and ${matches.length} matches`);
        
        await matchService.recalculateAllTeamStats();
        
        // Refresh the UI
        await refreshTeamsList();
        await refreshStats();
        
        console.log('Stats recalculation completed');
        showNotification('Team statistics recalculated successfully!');
    } catch (error) {
        console.error('Error recalculating statistics:', error);
        showNotification('Error recalculating statistics: ' + error.message, 'error');
    }
}

// Simple function to recalculate team stats from existing matches
async function recalculateTeamStats() {
    try {
        console.log('Recalculating team statistics...');
        
        const allMatches = await matchService.getAllMatches();
        const allTeams = await teamService.getAllTeams();
        const completedMatches = allMatches.filter(match => match.status === 'completed');
        
        console.log(`Found ${allTeams.length} teams and ${completedMatches.length} completed matches`);
        
        // Reset all team statistics
        for (const team of allTeams) {
            const resetStats = {
                'stats.matchesPlayed': 0,
                'stats.wins': 0,
                'stats.losses': 0,
                'stats.draws': 0,
                'stats.points': 0,
                'stats.totalScore': 0,
                'stats.roundsWon': 0,
                'stats.roundsLost': 0
            };
            await teamService.firebaseService.updateTeam(team.id, resetStats);
        }
        
        console.log('Reset all team statistics');
        
        // Process completed matches
        for (const match of completedMatches) {
            await matchService.updateTeamStats(match.team1Id, match.team2Id, match);
        }
        
        console.log('Team statistics recalculation completed');
        return true;
    } catch (error) {
        console.error('Error recalculating team statistics:', error);
        return false;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    const firebaseService = new FirebaseService();
    const migrationService = new MigrationService(storage, firebaseService);

    // Initialize services
    initializeTeamService(firebaseService);
    initializeMatchService(firebaseService);

    await migrationService.migrateData();

    // Initialize the application with data from Firebase
    await initializeApp(firebaseService);
});

async function initializeApp(firebaseService) {
    // Set up real-time listeners
    firebaseService.subscribeToTeams(teams => {
        console.log('Received real-time update for teams:', teams);
        refreshTeamsList();
    });

    firebaseService.subscribeToMatches(matches => {
        console.log('Received real-time update for matches:', matches);
        refreshMatchesList();
    });

    // Recalculate stats from existing data
    await recalculateTeamStats();
    
    // Initial load
    showSection('teams');
}