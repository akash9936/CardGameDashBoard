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

document.querySelectorAll('.sticky-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        showSection(btn.dataset.target);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});

(function setupStickyNav() {
    const sticky = document.getElementById('stickyNav');
    if (!sticky) return;
    const onScroll = () => {
        sticky.classList.toggle('visible', window.scrollY > 180);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
})();

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
                            <input type="number" id="team1Promise" min="4" max="13" required>
                            <div class="validation-hint">Must be between 4 and 13</div>
                        </div>
                        <div class="form-group">
                            <label for="team1Actual">Actual Hand</label>
                            <input type="number" id="team1Actual" min="0" required>
                            <div class="validation-hint">Team 1 + Team 2 actual hands must equal 13</div>
                        </div>
                    </div>
                    <div class="team-inputs">
                        <h4>${teams.team2.name}</h4>
                        <div class="form-group">
                            <label for="team2Promise">Promise Hand</label>
                            <input type="number" id="team2Promise" min="4" max="13" required>
                            <div class="validation-hint">Must be between 4 and 13</div>
                        </div>
                        <div class="form-group">
                            <label for="team2Actual">Actual Hand</label>
                            <input type="number" id="team2Actual" min="0" required>
                            <div class="validation-hint">Team 1 + Team 2 actual hands must equal 13</div>
                        </div>
                    </div>
                </div>
                <div class="validation-hint" style="margin-bottom: 20px;">
                    <strong>Validation Rules:</strong><br>
                    • Promise hands must be between 4 and 13 for each team<br>
                    • Actual hands of both teams must equal 13<br>
                    • Total score cannot exceed 200 or be less than -100
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
                    
                    // Scores follow CLAUDE.md §4 — derived by Match.computeScore.
                    const team1Score = Match.computeScore(team1Promise, team1Actual);
                    const team2Score = Match.computeScore(team2Promise, team2Actual);

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
                // Scores follow CLAUDE.md §4 — derived by Match.computeScore.
                const team1Score = Match.computeScore(team1Promise, team1Actual);
                const team2Score = Match.computeScore(team2Promise, team2Actual);

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
    // Update navigation buttons (both top + sticky)
    elements.viewTeams.classList.toggle('active', section === 'teams');
    elements.viewMatches.classList.toggle('active', section === 'matches');
    elements.viewStats.classList.toggle('active', section === 'stats');
    document.querySelectorAll('.sticky-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === section);
    });

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
    destroyTeamCharts();
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
const _firstLoad = { teams: true, matches: true, stats: true };

function skeletonCards(n = 3) {
    let html = '';
    for (let i = 0; i < n; i++) html += `
        <div class="skeleton skeleton-card">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line skeleton-short"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
        </div>`;
    return html;
}

function skeletonRows(n = 4) {
    let html = '';
    for (let i = 0; i < n; i++) html += `<div class="skeleton skeleton-row"></div>`;
    return html;
}

function emptyState({ icon, title, sub, cta }) {
    const ctaHtml = cta ? `<button class="action-btn" data-empty-cta="${cta.target}">${cta.label}</button>` : '';
    return `
        <div class="empty-state">
            <div class="empty-icon">${icon}</div>
            <h3 class="empty-title">${title}</h3>
            <p class="empty-sub">${sub}</p>
            ${ctaHtml}
        </div>
    `;
}

function wireEmptyStateCtas(container) {
    container.querySelectorAll('[data-empty-cta]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.emptyCta;
            if (target === 'addTeam') document.getElementById('addTeamBtn')?.click();
            else if (target === 'addMatch') document.getElementById('addMatchBtn')?.click();
            else if (target === 'matchesSection') showSection('matches');
        });
    });
}

function renderHotStrip(teams, matches) {
    const el = document.getElementById('hotStrip');
    if (!el) return;
    const items = [];

    const streak = StatsUtils.hottestStreak(teams, matches, 3);
    if (streak && streak.type === 'W') {
        items.push(`<span class="hot-chip hot-streak">🔥 ${streak.name} on a ${streak.count}-game win streak</span>`);
    }

    const top = StatsUtils.topRoundScore(matches);
    if (top && top.score > 0) {
        items.push(`<span class="hot-chip hot-round">⭐ Highest round: +${top.score} (R${top.roundNumber})</span>`);
    }

    const rivalry = StatsUtils.topRivalry(matches);
    if (rivalry && rivalry.count >= 3) {
        const t1 = teams.find(t => String(t.id) === rivalry.team1Id)?.name || rivalry.team1Id;
        const t2 = teams.find(t => String(t.id) === rivalry.team2Id)?.name || rivalry.team2Id;
        items.push(`<span class="hot-chip hot-rivalry">⚔️ Top rivalry: ${t1} vs ${t2} (${rivalry.count})</span>`);
    }

    el.innerHTML = items.join('');
    el.style.display = items.length ? '' : 'none';
}

async function refreshTeamsList() {
    if (_firstLoad.teams) {
        elements.teamsList.innerHTML = skeletonCards(3);
        _firstLoad.teams = false;
    }
    const teams = await teamService.getAllTeams();
    console.log('Teams retrieved:', teams);

    if (!teams.length) {
        elements.teamsList.innerHTML = emptyState({
            icon: '🃏',
            title: 'No teams yet',
            sub: 'Add your first team to start the tournament.',
            cta: { label: '+ Add New Team', target: 'addTeam' },
        });
        wireEmptyStateCtas(elements.teamsList);
        return;
    }

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

const _wormCharts = new Map();

function renderScorecard(match, team1, team2) {
    const rounds = (Array.isArray(match.rounds) ? match.rounds : []).slice()
        .sort((a, b) => a.roundNumber - b.roundNumber);
    const summary = StatsUtils.matchSummary(match);

    const rows = rounds.map(r => {
        const c1 = StatsUtils.roundOutcome(r.team1);
        const c2 = StatsUtils.roundOutcome(r.team2);
        const s1 = Number(r.team1?.score || 0);
        const s2 = Number(r.team2?.score || 0);
        const winnerCol = s1 > s2 ? 't1' : s2 > s1 ? 't2' : 'tie';
        const blindBadge = (side) => StatsUtils.isBlindSide(side) ? '<span class="blind-badge" title="Blind bid">B</span>' : '';
        return `
            <tr>
                <td class="r-num">${r.roundNumber}</td>
                <td>${r.team1?.promise ?? ''}${blindBadge(r.team1)}</td>
                <td>${r.team1?.actual ?? ''}</td>
                <td class="score-cell outcome-${c1}">${s1 >= 0 ? '+' : ''}${s1}</td>
                <td>${r.team2?.promise ?? ''}${blindBadge(r.team2)}</td>
                <td>${r.team2?.actual ?? ''}</td>
                <td class="score-cell outcome-${c2}">${s2 >= 0 ? '+' : ''}${s2}</td>
                <td class="winner-cell ${winnerCol}">${winnerCol === 't1' ? team1.name : winnerCol === 't2' ? team2.name : '—'}</td>
            </tr>
        `;
    }).join('');

    const summaryBits = [];
    if (summary.blinds) summaryBits.push(`<span class="chip chip-gold">${summary.blinds} blind${summary.blinds > 1 ? 's' : ''}</span>`);
    if (summary.overExtensions) summaryBits.push(`<span class="chip chip-purple">${summary.overExtensions} over-extension${summary.overExtensions > 1 ? 's' : ''}</span>`);
    if (summary.biggestSwing.round) summaryBits.push(`<span class="chip">Biggest swing: R${summary.biggestSwing.round} (Δ${summary.biggestSwing.delta})</span>`);

    return `
        <div class="scorecard">
            <div class="scorecard-chart-wrap">
                <canvas class="worm-chart" data-match-id="${match.id}"></canvas>
            </div>
            <div class="scorecard-summary">${summaryBits.join('') || '<span class="chip">No rounds yet</span>'}</div>
            <div class="scorecard-table-wrap">
                <table class="scorecard-table">
                    <thead>
                        <tr>
                            <th rowspan="2">R</th>
                            <th colspan="3" class="t1-head">${team1.name}</th>
                            <th colspan="3" class="t2-head">${team2.name}</th>
                            <th rowspan="2">Round Winner</th>
                        </tr>
                        <tr>
                            <th>P</th><th>A</th><th>Score</th>
                            <th>P</th><th>A</th><th>Score</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function mountSparklines() {
    const css = getComputedStyle(document.documentElement);
    const c1 = css.getPropertyValue('--primary-color').trim() || '#6366f1';
    const c2 = css.getPropertyValue('--accent-color').trim() || '#10b981';
    const dpr = window.devicePixelRatio || 1;

    document.querySelectorAll('canvas.sparkline').forEach(async (canvas) => {
        const matchId = canvas.dataset.matchId;
        const match = (await matchService.getAllMatches()).find(m => String(m.id) === String(matchId));
        if (!match) return;
        const { team1, team2 } = StatsUtils.cumulativeSeries(match);
        const w = canvas.clientWidth || 120, h = canvas.clientHeight || 28;
        canvas.width = w * dpr; canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        const all = team1.concat(team2);
        const min = Math.min(...all), max = Math.max(...all);
        const range = max - min || 1;
        const stepX = w / Math.max(1, team1.length - 1);
        const yOf = v => h - 2 - ((v - min) / range) * (h - 4);
        const drawLine = (series, color) => {
            ctx.beginPath();
            series.forEach((v, i) => {
                const x = i * stepX, y = yOf(v);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        };
        drawLine(team1, c1);
        drawLine(team2, c2);
    });
}

function mountWormCharts() {
    for (const [, chart] of _wormCharts) chart.destroy();
    _wormCharts.clear();

    if (typeof Chart === 'undefined') return;

    const canvases = document.querySelectorAll('canvas.worm-chart');
    canvases.forEach(async (canvas) => {
        const matchId = canvas.dataset.matchId;
        const match = (await matchService.getAllMatches()).find(m => String(m.id) === String(matchId));
        if (!match) return;
        const teams = await teamService.getAllTeams();
        const team1 = teams.find(t => String(t.id) === String(match.team1Id));
        const team2 = teams.find(t => String(t.id) === String(match.team2Id));
        if (!team1 || !team2) return;

        const series = StatsUtils.cumulativeSeries(match);
        const css = getComputedStyle(document.documentElement);
        const c1 = css.getPropertyValue('--primary-color').trim() || '#6366f1';
        const c2 = css.getPropertyValue('--accent-color').trim() || '#10b981';
        const muted = css.getPropertyValue('--text-muted').trim() || '#94a3b8';

        const winLinePlugin = {
            id: 'winLine',
            afterDraw(chart) {
                const { ctx, chartArea, scales } = chart;
                if (!scales.y) return;
                const yMax = scales.y.max ?? 500;
                if (yMax < 500) return;
                const y = scales.y.getPixelForValue(500);
                if (y < chartArea.top || y > chartArea.bottom) return;
                ctx.save();
                ctx.strokeStyle = '#fbbf24';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#fbbf24';
                ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'bottom';
                ctx.fillText('Win @ 500', chartArea.right - 6, y - 4);
                ctx.restore();
            },
        };

        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: series.labels,
                datasets: [
                    { label: team1.name, data: series.team1, borderColor: c1, backgroundColor: c1 + '22', tension: 0.25, fill: false, pointRadius: 3 },
                    { label: team2.name, data: series.team2, borderColor: c2, backgroundColor: c2 + '22', tension: 0.25, fill: false, pointRadius: 3 },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: muted } },
                },
                scales: {
                    x: { ticks: { color: muted }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y: {
                        ticks: { color: muted },
                        grid: { color: 'rgba(148,163,184,0.1)' },
                        suggestedMin: 0,
                        suggestedMax: 550,
                    },
                },
            },
            plugins: [winLinePlugin],
        });
        _wormCharts.set(String(matchId), chart);
    });
}

async function refreshMatchesList() {
    if (_firstLoad.matches) {
        elements.matchesList.innerHTML = skeletonCards(2);
        _firstLoad.matches = false;
    }
    const matches = await matchService.getAllMatches();
    const teams = await teamService.getAllTeams();

    if (teams.length === 0) {
        elements.matchesList.innerHTML = emptyState({
            icon: '🃏',
            title: 'No teams yet',
            sub: 'Create at least two teams before starting a match.',
            cta: { label: '+ Add New Team', target: 'addTeam' },
        });
        wireEmptyStateCtas(elements.matchesList);
        return;
    }

    if (!matches.length) {
        elements.matchesList.innerHTML = emptyState({
            icon: '🎯',
            title: 'No matches yet',
            sub: 'Pick two teams and start the first match.',
            cta: { label: '+ New Match', target: 'addMatch' },
        });
        wireEmptyStateCtas(elements.matchesList);
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
                    ${rounds.length > 0 ? `<canvas class="sparkline" data-match-id="${match.id}" width="120" height="28"></canvas>` : ''}
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
                        <form onsubmit="submitRound(event, '${match.id}')" class="round-form" oninput="recalcRoundScores('${match.id}')">
                            <div class="round-inputs">
                                <div class="team-inputs">
                                    <h5>${team1.name}</h5>
                                    <div class="form-group">
                                        <label for="team1Promise${match.id}" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                            <span>Promise Hand</span>
                                            <label style="font-weight: normal; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                                                <input type="checkbox" id="team1Blind${match.id}" onchange="recalcRoundScores('${match.id}')">
                                                Blind (auto 7)
                                            </label>
                                        </label>
                                        <input type="number" id="team1Promise${match.id}" min="4" max="13" required>
                                        <div class="validation-hint">Must be between 4 and 13 (or check Blind for fixed 7)</div>
                                    </div>
                                    <div class="form-group">
                                        <label for="team1Actual${match.id}">Actual Hand</label>
                                        <input type="number" id="team1Actual${match.id}" min="0" max="13" required>
                                        <div class="validation-hint">Team 1 + Team 2 actual hands must equal 13</div>
                                    </div>
                                    <div class="form-group">
                                        <label for="team1Score${match.id}">Score (auto)</label>
                                        <input type="number" id="team1Score${match.id}" readonly tabindex="-1">
                                    </div>
                                </div>
                                <div class="team-inputs">
                                    <h5>${team2.name}</h5>
                                    <div class="form-group">
                                        <label for="team2Promise${match.id}" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                            <span>Promise Hand</span>
                                            <label style="font-weight: normal; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                                                <input type="checkbox" id="team2Blind${match.id}" onchange="recalcRoundScores('${match.id}')">
                                                Blind (auto 7)
                                            </label>
                                        </label>
                                        <input type="number" id="team2Promise${match.id}" min="4" max="13" required>
                                        <div class="validation-hint">Must be between 4 and 13 (or check Blind for fixed 7)</div>
                                    </div>
                                    <div class="form-group">
                                        <label for="team2Actual${match.id}">Actual Hand</label>
                                        <input type="number" id="team2Actual${match.id}" min="0" max="13" required>
                                        <div class="validation-hint">Team 1 + Team 2 actual hands must equal 13</div>
                                    </div>
                                    <div class="form-group">
                                        <label for="team2Score${match.id}">Score (auto)</label>
                                        <input type="number" id="team2Score${match.id}" readonly tabindex="-1">
                                    </div>
                                </div>
                            </div>
                            <div class="validation-hint" style="margin-bottom: 20px;">
                                <strong>Scoring rules (CLAUDE.md §4):</strong><br>
                                • Under-promise (Actual &lt; Promise) → −(Promise × 10)<br>
                                • Over-extension (Actual ≥ Promise × 2) → −(Promise × 10)<br>
                                • Met with extras (Promise ≤ Actual &lt; Promise × 2) → (Promise × 10) + extras<br>
                                • Blind (fixed promise 7): Actual ≥ 7 → +140; Actual &lt; 7 → −70
                            </div>
                            <button type="submit" class="action-btn">Submit Round</button>
                            <button type="button" onclick="cancelMatch('${match.id}')" class="action-btn danger">Cancel Match</button>
                        </form>
                    </div>
                ` : ''}
                ${rounds.length > 0 ? renderScorecard(match, team1, team2) : ''}
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

    mountSparklines();
    mountWormCharts();
}

let _leaderboardSort = { key: 'rank', dir: 'asc' };

function renderKpiTiles(kpis) {
    const tiles = [
        { label: 'Matches', value: kpis.totalMatches, accent: 'primary' },
        { label: 'Rounds Played', value: kpis.totalRounds, accent: 'info' },
        { label: 'Highest Round', value: kpis.highestRoundScore, accent: 'success' },
        { label: 'Blinds Called', value: kpis.blindsCalled, accent: 'warning' },
    ];
    document.getElementById('kpiTiles').innerHTML = tiles.map(t => `
        <div class="kpi-tile kpi-${t.accent}">
            <div class="kpi-value">${t.value}</div>
            <div class="kpi-label">${t.label}</div>
        </div>
    `).join('');
}

function renderLeaderboard(rows, form) {
    const { key, dir } = _leaderboardSort;
    const sorted = rows.slice().sort((a, b) => {
        const av = a[key], bv = b[key];
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        return dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('leaderboardBody').innerHTML = sorted.map(r => {
        const rankClass = r.rank <= 3 ? `rank-${r.rank}` : '';
        const formChips = (form.get(r.id) || []).map(o =>
            `<span class="form-chip form-${o.toLowerCase()}">${o}</span>`
        ).join('');
        return `
            <tr class="${rankClass}">
                <td class="rank-cell">${r.rank}</td>
                <td class="team-cell">${r.name}</td>
                <td>${r.played}</td>
                <td class="num pos">${r.wins}</td>
                <td class="num neg">${r.losses}</td>
                <td>${r.winPct.toFixed(1)}%</td>
                <td class="pts">${r.points}</td>
                <td>${r.totalScore}</td>
                <td>${r.avgScore.toFixed(0)}</td>
                <td class="form-cell">${formChips || '<span class="form-empty">—</span>'}</td>
            </tr>
        `;
    }).join('');
}

function wireLeaderboardSort() {
    const ths = document.querySelectorAll('#leaderboardTable thead th[data-sort]');
    ths.forEach(th => {
        if (th.dataset.wired) return;
        th.dataset.wired = '1';
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (_leaderboardSort.key === key) {
                _leaderboardSort.dir = _leaderboardSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                _leaderboardSort.key = key;
                _leaderboardSort.dir = key === 'name' || key === 'rank' ? 'asc' : 'desc';
            }
            refreshStats();
        });
    });
}

async function refreshStats() {
    if (_firstLoad.stats) {
        document.getElementById('leaderboardBody').innerHTML = skeletonRows(5);
        elements.recentActivity.innerHTML = skeletonRows(3);
        _firstLoad.stats = false;
    }
    const teams = await teamService.getAllTeams();
    const matches = await matchService.getAllMatches();

    renderHotStrip(teams, matches);
    renderKpiTiles(StatsUtils.kpis(matches));
    const rows = StatsUtils.leaderboard(teams, matches);
    const form = StatsUtils.recentForm(teams, matches, 5);
    renderLeaderboard(rows, form);
    wireLeaderboardSort();

    const recentMatches = await matchService.getRecentMatches();
    if (!recentMatches.length) {
        elements.recentActivity.innerHTML = emptyState({
            icon: '📊',
            title: 'No activity yet',
            sub: 'Stats appear once a match is started or completed.',
            cta: { label: 'Go to Matches', target: 'matchesSection' },
        });
        wireEmptyStateCtas(elements.recentActivity);
        return;
    }
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

const _teamCharts = new Map();

function destroyTeamCharts() {
    for (const [, chart] of _teamCharts) chart.destroy();
    _teamCharts.clear();
}

function renderTeamOverview(profile, allTeams, matches) {
    const formChips = StatsUtils.recentForm(allTeams, matches, 5).get(profile.id) || [];
    const formHtml = formChips.length
        ? formChips.map(o => `<span class="form-chip form-${o.toLowerCase()}">${o}</span>`).join('')
        : '<span class="form-empty">No matches yet</span>';

    let h2hHtml = '';
    if (profile.topOpponentId) {
        const opp = allTeams.find(t => String(t.id) === profile.topOpponentId);
        const h2h = StatsUtils.headToHead(profile.id, profile.topOpponentId, matches);
        const recentChips = h2h.recent.map(o => `<span class="form-chip form-${o.toLowerCase()}">${o}</span>`).join('') || '<span class="form-empty">—</span>';
        h2hHtml = `
            <div class="td-h2h">
                <h4>Head-to-Head vs ${opp ? opp.name : profile.topOpponentId}</h4>
                <div class="td-h2h-row">
                    <div class="td-h2h-record"><strong>${h2h.wins}</strong>W &nbsp;–&nbsp; <strong>${h2h.losses}</strong>L</div>
                    <div class="td-h2h-meta">${h2h.played} matches</div>
                </div>
                <div class="td-h2h-recent">Last 3: ${recentChips}</div>
            </div>
        `;
    }

    return `
        <div class="td-overview">
            <div class="kpi-tiles">
                <div class="kpi-tile kpi-primary"><div class="kpi-value">${profile.points}</div><div class="kpi-label">Points</div></div>
                <div class="kpi-tile kpi-success"><div class="kpi-value">${profile.wins}–${profile.losses}</div><div class="kpi-label">W – L</div></div>
                <div class="kpi-tile kpi-info"><div class="kpi-value">${profile.winPct.toFixed(0)}%</div><div class="kpi-label">Win Rate</div></div>
                <div class="kpi-tile kpi-warning"><div class="kpi-value">${profile.bestMatchScore}</div><div class="kpi-label">Best Match</div></div>
            </div>
            <div class="td-row">
                <div class="td-card">
                    <h4>Recent Form</h4>
                    <div class="form-cell">${formHtml}</div>
                </div>
                <div class="td-card">
                    <h4>Totals</h4>
                    <p><span class="td-label">Total score:</span> <strong>${profile.totalScore}</strong></p>
                    <p><span class="td-label">Avg / match:</span> <strong>${profile.avgScore.toFixed(0)}</strong></p>
                    <p><span class="td-label">Rounds W/L:</span> <strong>${profile.roundsWon}/${profile.roundsLost}</strong></p>
                </div>
                ${h2hHtml ? `<div class="td-card">${h2hHtml}</div>` : ''}
            </div>
        </div>
    `;
}

function renderTeamMatchesTab(profile, allTeams) {
    if (!profile.allMatches.length) return '<p class="td-empty">No matches yet.</p>';
    const rows = profile.allMatches.map(m => {
        const side = StatsUtils.teamSide(m, profile.id);
        const oppId = StatsUtils.opponentId(m, profile.id);
        const opp = allTeams.find(t => String(t.id) === oppId);
        const myScore = Number(m.finalScore?.[side] || 0);
        const oppScore = Number(m.finalScore?.[side === 'team1' ? 'team2' : 'team1'] || 0);
        let resultCell = '<span class="result-chip result-pending">Pending</span>';
        if (m.status === 'completed') {
            const won = String(m.winnerId) === profile.id;
            resultCell = won
                ? '<span class="result-chip result-win">Won</span>'
                : '<span class="result-chip result-loss">Lost</span>';
        } else if (m.status === 'cancelled') {
            resultCell = '<span class="result-chip result-cancelled">Cancelled</span>';
        } else if (m.status === 'in_progress') {
            resultCell = '<span class="result-chip result-progress">In progress</span>';
        }
        return `
            <tr>
                <td>${DateUtils.formatDate(m.date)}</td>
                <td>${opp ? opp.name : oppId}</td>
                <td>${resultCell}</td>
                <td class="num">${myScore} – ${oppScore}</td>
            </tr>
        `;
    }).join('');
    return `
        <div class="td-table-wrap">
            <table class="td-table">
                <thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th>Score</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function renderTeamTrendsTab(profile) {
    if (!profile.played) return '<p class="td-empty">Trends will appear once this team completes a match.</p>';
    return `
        <div class="td-charts">
            <div class="td-chart-card">
                <h4>Score per Match</h4>
                <div class="td-chart-wrap"><canvas id="teamScoreChart"></canvas></div>
            </div>
            <div class="td-chart-card">
                <h4>Promise vs Actual</h4>
                <div class="td-chart-wrap"><canvas id="teamPaChart"></canvas></div>
                <p class="td-chart-legend">Each dot = one round. Diagonal = met promise exactly. Above = took more than promised, below = took less.</p>
            </div>
        </div>
    `;
}

function mountTeamCharts(profile, matches) {
    destroyTeamCharts();
    if (typeof Chart === 'undefined') return;

    const css = getComputedStyle(document.documentElement);
    const c1 = css.getPropertyValue('--primary-color').trim() || '#6366f1';
    const c2 = css.getPropertyValue('--accent-color').trim() || '#10b981';
    const muted = css.getPropertyValue('--text-muted').trim() || '#94a3b8';

    const scoreEl = document.getElementById('teamScoreChart');
    if (scoreEl) {
        const series = StatsUtils.teamScoreSeries(profile.id, matches);
        _teamCharts.set('score', new Chart(scoreEl, {
            type: 'line',
            data: {
                labels: series.map(p => `M${p.x}`),
                datasets: [{
                    label: profile.name,
                    data: series.map(p => p.y),
                    borderColor: c1,
                    backgroundColor: c1 + '22',
                    tension: 0.25,
                    pointRadius: 3,
                    fill: false,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: muted }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y: { ticks: { color: muted }, grid: { color: 'rgba(148,163,184,0.1)' } },
                },
            },
        }));
    }

    const paEl = document.getElementById('teamPaChart');
    if (paEl) {
        const pts = StatsUtils.teamPromiseActualPoints(profile.id, matches);
        _teamCharts.set('pa', new Chart(paEl, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Round',
                    data: pts.map(p => ({ x: p.x, y: p.y })),
                    backgroundColor: pts.map(p => p.blind ? '#fbbf24' : (p.score > 0 ? c2 : 'rgba(239,68,68,0.7)')),
                    pointRadius: 5,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { title: { display: true, text: 'Promise', color: muted }, min: 0, max: 14, ticks: { color: muted, stepSize: 1 }, grid: { color: 'rgba(148,163,184,0.1)' } },
                    y: { title: { display: true, text: 'Actual', color: muted }, min: 0, max: 14, ticks: { color: muted, stepSize: 1 }, grid: { color: 'rgba(148,163,184,0.1)' } },
                },
            },
        }));
    }
}

function wireTeamTabs(profile, allTeams, matches) {
    const tabs = document.querySelectorAll('.td-tab');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabs.forEach(t => t.classList.toggle('active', t === btn));
            const body = document.getElementById('teamDetailsBody');
            if (target === 'overview') body.innerHTML = renderTeamOverview(profile, allTeams, matches);
            else if (target === 'matches') body.innerHTML = renderTeamMatchesTab(profile, allTeams);
            else if (target === 'trends') {
                body.innerHTML = renderTeamTrendsTab(profile);
                requestAnimationFrame(() => mountTeamCharts(profile, matches));
            }
        });
    });
}

async function viewTeamDetails(teamId) {
    const allTeams = await teamService.getAllTeams();
    const matches = await matchService.getAllMatches();
    const profile = StatsUtils.teamProfile(teamId, allTeams, matches);
    if (!profile) {
        showModal('<p>Team not found.</p>');
        return;
    }

    showModal(`
        <div class="team-details-modal">
            <div class="td-header">
                <h2>${profile.name}</h2>
                <div class="td-meta">
                    ${profile.members.length ? profile.members.map(m => `<span class="td-member">${m}</span>`).join('') : '<span class="td-empty">No members listed</span>'}
                </div>
            </div>
            <div class="td-tabs">
                <button class="td-tab active" data-tab="overview">Overview</button>
                <button class="td-tab" data-tab="matches">Matches</button>
                <button class="td-tab" data-tab="trends">Trends</button>
            </div>
            <div id="teamDetailsBody">${renderTeamOverview(profile, allTeams, matches)}</div>
        </div>
    `);

    wireTeamTabs(profile, allTeams, matches);
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

    const team1Blind = !!document.getElementById(`team1Blind${matchId}`)?.checked;
    const team2Blind = !!document.getElementById(`team2Blind${matchId}`)?.checked;

    // Blind locks promise to 7 (CLAUDE.md §4.4).
    const team1Promise = team1Blind ? 7 : parseInt(document.getElementById(`team1Promise${matchId}`).value);
    const team1Actual = parseInt(document.getElementById(`team1Actual${matchId}`).value);
    const team2Promise = team2Blind ? 7 : parseInt(document.getElementById(`team2Promise${matchId}`).value);
    const team2Actual = parseInt(document.getElementById(`team2Actual${matchId}`).value);

    if (isNaN(team1Promise) || isNaN(team1Actual) || isNaN(team2Promise) || isNaN(team2Actual)) {
        showNotification('Please enter valid numbers for all fields', 'error');
        return;
    }

    // Scores are derived from CLAUDE.md §4 — never trust the (read-only) DOM value.
    const team1Score = Match.computeScore(team1Promise, team1Actual, { blind: team1Blind });
    const team2Score = Match.computeScore(team2Promise, team2Actual, { blind: team2Blind });

    try {
        await matchService.addRound(
            matchId,
            team1Promise,
            team1Actual,
            team2Promise,
            team2Actual,
            team1Score,
            team2Score,
            { team1Blind, team2Blind }
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
document.addEventListener('wheel', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) {
        e.target.blur();
    }
}, { passive: true });

document.addEventListener('DOMContentLoaded', async () => {
    const firebaseService = new FirebaseService();

    initializeTeamService(firebaseService);
    initializeMatchService(firebaseService);

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

// Live-recalculate the read-only Score fields whenever Promise/Actual/Blind
// changes in the per-match round form. Scoring follows CLAUDE.md §4.
// When Blind is checked for a team, its promise locks to 7 and that input
// is disabled (CLAUDE.md §4.4).
function recalcRoundScores(matchId) {
    for (const team of ['team1', 'team2']) {
        const blindEl = document.getElementById(`${team}Blind${matchId}`);
        const promiseEl = document.getElementById(`${team}Promise${matchId}`);
        const actualEl = document.getElementById(`${team}Actual${matchId}`);
        const scoreEl = document.getElementById(`${team}Score${matchId}`);
        if (!blindEl || !promiseEl || !actualEl || !scoreEl) return;

        const blind = blindEl.checked;
        if (blind) {
            promiseEl.value = 7;
            promiseEl.disabled = true;
        } else {
            promiseEl.disabled = false;
        }

        const promise = parseInt(promiseEl.value, 10);
        const actual = parseInt(actualEl.value, 10);
        const promiseOk = blind || (Number.isFinite(promise) && promise >= 4 && promise <= 13);
        const actualOk = Number.isFinite(actual) && actual >= 0 && actual <= 13;

        scoreEl.value = (promiseOk && actualOk)
            ? Match.computeScore(blind ? 7 : promise, actual, { blind })
            : '';
    }
}
window.recalcRoundScores = recalcRoundScores;