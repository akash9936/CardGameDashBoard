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
document.getElementById('aiSettingsBtn')?.addEventListener('click', () => {
    if (typeof AICommentary !== 'undefined') AICommentary.openSettings();
});

// 🔊 Audio toggle — spoken commentary (ai-commentary.md § Spoken commentary).
function syncAudioToggleButton() {
    const btn = document.getElementById('audioToggleBtn');
    if (!btn || typeof AudioCommentary === 'undefined') return;
    if (!AudioCommentary.isSupported()) {
        btn.style.display = 'none';
        return;
    }
    const on = AudioCommentary.isEnabled();
    btn.textContent = on ? '🔊 Audio' : '🔇 Audio';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('audio-on', on);
}
document.getElementById('audioToggleBtn')?.addEventListener('click', () => {
    if (typeof AudioCommentary === 'undefined') return;
    AudioCommentary.toggle();
    syncAudioToggleButton();
    showNotification(AudioCommentary.isEnabled()
        ? 'Commentary on.'
        : 'Commentary off.');
});
syncAudioToggleButton();

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
            refreshMatchesList().then(() => {
                if (typeof Walkthrough !== 'undefined') Walkthrough.maybeAutoStart();
            });
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

function renderH2hMatrix(teams, matches) {
    const tbl = document.getElementById('h2hMatrix');
    if (!tbl) return;
    if (teams.length < 2) { tbl.innerHTML = ''; return; }

    const m = StatsUtils.headToHeadMatrix(teams, matches);
    const teamsById = new Map(teams.map(t => [String(t.id), t]));
    const mark = (id) => (typeof TeamMark !== 'undefined')
        ? TeamMark.render(teamsById.get(String(id)) || { id, name: m.namesById.get(id) }, { size: 'sm' })
        : `<span class="team-dot" style="background:${StatsUtils.teamColor(id)}"></span>`;
    const head = `
        <thead>
            <tr>
                <th class="h2h-corner"></th>
                ${m.ids.map(id => `<th class="h2h-colhead" title="${m.namesById.get(id)}">${mark(id)}${m.namesById.get(id)}</th>`).join('')}
            </tr>
        </thead>
    `;
    const rows = m.ids.map(rowId => {
        const cells = m.ids.map(colId => {
            if (rowId === colId) return '<td class="h2h-diag">—</td>';
            const h = m.cells[rowId][colId];
            if (!h || h.played === 0) return '<td class="h2h-empty">—</td>';
            let cls = 'h2h-tie';
            if (h.wins > h.losses) cls = 'h2h-win';
            else if (h.losses > h.wins) cls = 'h2h-loss';
            return `
                <td class="${cls} h2h-clickable" data-row="${rowId}" data-col="${colId}" title="View ${m.namesById.get(rowId)}'s matches vs ${m.namesById.get(colId)}">
                    <div class="h2h-record">${h.wins}–${h.losses}</div>
                    <div class="h2h-played">${h.played} played</div>
                </td>
            `;
        }).join('');
        return `<tr><th class="h2h-rowhead">${mark(rowId)}${m.namesById.get(rowId)}</th>${cells}</tr>`;
    }).join('');
    tbl.innerHTML = head + `<tbody>${rows}</tbody>`;

    tbl.querySelectorAll('.h2h-clickable').forEach(cell => {
        cell.addEventListener('click', () => {
            viewTeamDetails(cell.dataset.row, cell.dataset.col);
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
        
        const mark = (typeof TeamMark !== 'undefined')
            ? TeamMark.render(team, { size: 'md' })
            : '';
        return `
            <div class="card team-card" data-team-id="${team.id}">
                <button type="button" class="tc-edit-theme" data-edit-theme="${team.id}" title="Edit theme" aria-label="Edit theme">✎</button>
                <div class="tc-head">${mark}<h3>${team.name}</h3></div>
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

    document.querySelectorAll('[data-edit-theme]').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.editTheme;
            const target = teams.find(t => String(t.id) === String(id));
            if (target && typeof ThemePicker !== 'undefined') ThemePicker.open(target);
        });
    });
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
    if (match.status === 'completed' && rounds.length > 0) {
        summaryBits.push(`<button type="button" class="chip chip-replay" data-replay-match="${match.id}" title="Replay every round, paced at 0.7s each">▶ Replay All</button>`);
    }

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
                            <th colspan="3" class="t1-head" style="color:${StatsUtils.teamColor(team1.id)}">${team1.name}</th>
                            <th colspan="3" class="t2-head" style="color:${StatsUtils.teamColor(team2.id)}">${team2.name}</th>
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
    const dpr = window.devicePixelRatio || 1;

    document.querySelectorAll('canvas.sparkline').forEach(async (canvas) => {
        const matchId = canvas.dataset.matchId;
        const match = (await matchService.getAllMatches()).find(m => String(m.id) === String(matchId));
        if (!match) return;
        const tc1 = StatsUtils.teamColor(match.team1Id);
        const tc2 = StatsUtils.teamColor(match.team2Id);
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
        drawLine(team1, tc1);
        drawLine(team2, tc2);
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
        const c1 = StatsUtils.teamColor(match.team1Id);
        const c2 = StatsUtils.teamColor(match.team2Id);
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

        // Broadcast Strip (§3b.1) — only for live or completed matches.
        const broadcast = (status === 'in_progress' || status === 'completed')
            ? BroadcastStrip.render(match, teams)
            : '';

        const c1 = StatsUtils.teamColor(team1.id);
        const c2 = StatsUtils.teamColor(team2.id);
        const summary = (status === 'completed' || status === 'in_progress')
            ? StatsUtils.matchSummary(match)
            : null;
        const chipStrip = (status === 'completed') ? renderMatchChips(summary) : '';
        const t1WinClass = match.winnerId === match.team1Id ? 'winner' : (status === 'completed' ? 'loser' : '');
        const t2WinClass = match.winnerId === match.team2Id ? 'winner' : (status === 'completed' ? 'loser' : '');

        return `
            <div class="card match-card" data-match-id="${match.id}"
                 style="--band-1:${c1}; --band-2:${c2}">
                <span class="match-bands" aria-hidden="true">
                    <span></span><span></span>
                </span>
                ${broadcast}
                <div class="match-header">
                    <span class="match-date">${DateUtils.formatDate(match.date)}</span>
                    ${rounds.length > 0 ? `<canvas class="sparkline" data-match-id="${match.id}" width="120" height="28"></canvas>` : ''}
                    <span class="match-status ${status}">${status}</span>
                </div>
                <div class="match-teams">
                    <div class="team ${t1WinClass}">
                        <h3>${team1.name}</h3>
                        <div class="team-members">
                            ${team1.members.map(member => `<span class="member">${member}</span>`).join('')}
                        </div>
                        <span class="score">${finalScore.team1}</span>
                    </div>
                    <div class="team ${t2WinClass}">
                        <h3>${team2.name}</h3>
                        <div class="team-members">
                            ${team2.members.map(member => `<span class="member">${member}</span>`).join('')}
                        </div>
                        <span class="score">${finalScore.team2}</span>
                    </div>
                </div>
                ${chipStrip}
                ${status === 'pending' ? `
                    <div class="match-actions">
                        <button onclick="startMatch('${match.id}')" class="action-btn">Start Match</button>
                        <button onclick="cancelMatch('${match.id}')" class="action-btn danger">Cancel</button>
                    </div>
                ` : ''}
                ${status === 'in_progress' ? GameBoard.renderInline(match, team1, team2) : ''}
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

    // Wire the Game Board for every in-progress match now that its
    // markup is in the DOM. wire() is idempotent.
    if (typeof GameBoard !== 'undefined') {
        matches.filter(m => m.status === 'in_progress')
               .forEach(m => GameBoard.wire(m.id));
    }

    // AI Commentary layer (ai-commentary.md): win meters on live cards
    // (always) + pundit lines on the broadcast strips (when a key is set).
    if (typeof AICommentary !== 'undefined') {
        AICommentary.decorateMatchCards(matches, teams);
    }
}

let _leaderboardSort = { key: 'rank', dir: 'asc' };

function renderKpiTiles(kpis, accuracy, blinds) {
    const pct = v => `${Math.round((v || 0) * 100)}%`;
    const signed = v => (v > 0 ? `+${v}` : String(v));

    const accSub = accuracy?.tournament?.bid
        ? `${accuracy.tournament.met}/${accuracy.tournament.bid} promises met`
        : 'No rounds yet';
    const blindSub = blinds?.tournament?.called
        ? `${blinds.tournament.successes}/${blinds.tournament.called} hit · Net ${signed(blinds.tournament.netEV)}`
        : 'No blinds called';

    const tiles = [
        { label: 'Matches', value: kpis.totalMatches, sub: `${kpis.totalRounds} rounds`, accent: 'primary' },
        { label: 'Promise Accuracy', value: pct(accuracy?.tournament?.rate), sub: accSub, accent: 'info' },
        { label: 'Highest Round', value: kpis.highestRoundScore, sub: 'best single round', accent: 'success' },
        { label: 'Blinds Called', value: kpis.blindsCalled, sub: blindSub, accent: 'warning' },
    ];
    document.getElementById('kpiTiles').innerHTML = tiles.map(t => `
        <div class="kpi-tile kpi-${t.accent}">
            <div class="kpi-value">${t.value}</div>
            <div class="kpi-label">${t.label}</div>
            ${t.sub ? `<div class="kpi-sub">${t.sub}</div>` : ''}
        </div>
    `).join('');
}

let _leaderboardCompact = false;

function renderLeaderboard(rows, form, accuracy, teams) {
    const { key, dir } = _leaderboardSort;
    const compact = _leaderboardCompact;
    const teamsById = new Map((teams || []).map(t => [String(t.id), t]));
    // Hydrate rows with accuracy so the table can sort on it.
    const enriched = rows.map(r => {
        const a = accuracy?.byTeam?.[r.id];
        return { ...r, accRate: a?.rate ?? 0, accMet: a?.met ?? 0, accBid: a?.bid ?? 0 };
    });
    const sorted = enriched.slice().sort((a, b) => {
        const av = a[key], bv = b[key];
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
        return dir === 'asc' ? cmp : -cmp;
    });

    const maxTotal = Math.max(1, ...sorted.map(r => Math.abs(r.totalScore)));
    const maxAvg   = Math.max(1, ...sorted.map(r => Math.abs(r.avgScore)));

    const table = document.getElementById('leaderboardTable');
    if (table) table.classList.toggle('is-compact', compact);

    document.getElementById('leaderboardBody').innerHTML = sorted.map(r => {
        const rankClass = r.rank <= 3 ? `rank-${r.rank}` : '';
        const tc = StatsUtils.teamColor(r.id);
        const formChips = (form.get(r.id) || []).map(o =>
            `<span class="form-chip form-${o.toLowerCase()}">${o}</span>`
        ).join('');
        const accPct = Math.round(r.accRate * 100);
        const accCell = r.accBid > 0
            ? `<td class="acc-cell" title="${r.accMet} of ${r.accBid} promises met">
                  <div class="acc-bar" style="--acc-pct: ${accPct}%"></div>
                  <span class="acc-num">${accPct}%</span>
               </td>`
            : `<td class="acc-cell"><span class="form-empty">—</span></td>`;
        const totalPct = Math.min(100, Math.round(Math.abs(r.totalScore) / maxTotal * 100));
        const avgPct   = Math.min(100, Math.round(Math.abs(r.avgScore)   / maxAvg   * 100));
        const totalCell = `<td class="lb-bar-cell lb-col-total">
            <div class="lb-bar" style="--bar-pct:${totalPct}%; --bar-color:${tc}"></div>
            <span class="lb-bar-num">${r.totalScore}</span>
        </td>`;
        const avgCell = `<td class="lb-bar-cell">
            <div class="lb-bar" style="--bar-pct:${avgPct}%; --bar-color:${tc}"></div>
            <span class="lb-bar-num">${r.avgScore.toFixed(0)}</span>
        </td>`;
        const rankBadge = r.rank <= 3
            ? `<span class="rank-badge rank-badge-${r.rank}">${r.rank}</span>`
            : `<span class="rank-plain">${r.rank}</span>`;
        const sparkCell = `<td class="lb-spark-cell">
            <canvas class="lb-spark" data-team-id="${r.id}" width="80" height="24" aria-hidden="true"></canvas>
        </td>`;

        return `
            <tr class="${rankClass}" style="--team-color:${tc}">
                <td class="rank-cell">${rankBadge}</td>
                <td class="team-cell">${(typeof TeamMark !== 'undefined') ? TeamMark.render(teamsById.get(r.id) || { id: r.id, name: r.name }, { size: 'sm' }) : `<span class="team-dot" style="background:${tc}"></span>`}${r.name}</td>
                <td class="lb-col-played">${r.played}</td>
                <td class="num pos lb-col-wins">${r.wins}</td>
                <td class="num neg lb-col-losses">${r.losses}</td>
                <td>${r.winPct.toFixed(1)}%</td>
                <td class="pts">${r.points}</td>
                ${totalCell}
                ${avgCell}
                ${accCell}
                <td class="form-cell">${formChips || '<span class="form-empty">—</span>'}</td>
                ${sparkCell}
            </tr>
        `;
    }).join('');

    mountLeaderboardSparklines();
}

async function mountLeaderboardSparklines() {
    const canvases = document.querySelectorAll('canvas.lb-spark');
    if (!canvases.length) return;
    const matches = await matchService.getAllMatches();
    const dpr = window.devicePixelRatio || 1;
    canvases.forEach(canvas => {
        const teamId = canvas.dataset.teamId;
        const series = StatsUtils.teamScoreSeries(teamId, matches).slice(-5);
        const color = StatsUtils.teamColor(teamId);
        const w = canvas.clientWidth || 80, h = canvas.clientHeight || 24;
        canvas.width = w * dpr; canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        if (series.length < 2) {
            ctx.fillStyle = 'rgba(148,163,184,0.35)';
            ctx.font = '11px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('—', w / 2, h / 2);
            return;
        }
        const ys = series.map(p => p.y);
        const min = Math.min(...ys), max = Math.max(...ys);
        const range = max - min || 1;
        const stepX = w / (series.length - 1);
        const yOf = v => h - 2 - ((v - min) / range) * (h - 4);
        ctx.beginPath();
        series.forEach((p, i) => {
            const x = i * stepX, y = yOf(p.y);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
    });
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

    const compactBtn = document.getElementById('leaderboardCompactToggle');
    if (compactBtn && !compactBtn.dataset.wired) {
        compactBtn.dataset.wired = '1';
        compactBtn.addEventListener('click', () => {
            _leaderboardCompact = !_leaderboardCompact;
            compactBtn.setAttribute('aria-pressed', String(_leaderboardCompact));
            compactBtn.classList.toggle('is-on', _leaderboardCompact);
            refreshStats();
        });
    }
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
    // Fun-facts ticker (ai-commentary.md) — computed nuggets, no LLM needed.
    if (typeof AICommentary !== 'undefined') {
        AICommentary.mountTicker(teams, matches);
    }
    const accuracy = StatsUtils.promiseAccuracy(teams, matches);
    const blinds = StatsUtils.blindEconomy(matches);
    renderKpiTiles(StatsUtils.kpis(matches), accuracy, blinds);
    const rows = StatsUtils.leaderboard(teams, matches);
    const form = StatsUtils.recentForm(teams, matches, 5);
    renderLeaderboard(rows, form, accuracy, teams);
    wireLeaderboardSort();
    // Season records — a static pack generated from the whole archive
    // (scripts/season-facts.js). No key, no network, no recompute.
    if (typeof SeasonFactsBoard !== 'undefined') SeasonFactsBoard.mount();
    // Archetypes + tilt meters, from the same generated pack.
    if (typeof PersonalityCards !== 'undefined') PersonalityCards.mount();
    renderH2hMatrix(teams, matches);
    if (typeof ScoringLegend !== 'undefined') ScoringLegend.mount();

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
        return renderActivityCard(match, team1, team2);
    }).join('');
    wireActivityCards();
}

function renderActivityCard(match, team1, team2) {
    const c1 = StatsUtils.teamColor(team1.id);
    const c2 = StatsUtils.teamColor(team2.id);
    const status = match.status || 'pending';
    const rounds = Array.isArray(match.rounds) ? match.rounds.length : 0;
    const final = match.finalScore || { team1: 0, team2: 0 };

    let scoreLine;
    if (status === 'completed') {
        const t1Win = String(match.winnerId) === String(team1.id);
        const winName = t1Win ? team1.name : team2.name;
        const loseName = t1Win ? team2.name : team1.name;
        const winScore = t1Win ? final.team1 : final.team2;
        const loseScore = t1Win ? final.team2 : final.team1;
        scoreLine = `
            <span class="winner-name">${escapeHtml(winName)}</span>
            <span class="score-num">${winScore}</span>
            <span class="score-sep">–</span>
            <span class="score-num loser-name">${loseScore}</span>
            <span class="loser-name">${escapeHtml(loseName)}</span>
        `;
    } else if (status === 'in_progress') {
        scoreLine = `
            <span>${escapeHtml(team1.name)}</span>
            <span class="score-num">${final.team1}</span>
            <span class="score-sep">–</span>
            <span class="score-num">${final.team2}</span>
            <span>${escapeHtml(team2.name)}</span>
        `;
    } else {
        scoreLine = `
            <span>${escapeHtml(team1.name)}</span>
            <span class="activity-vs">vs</span>
            <span>${escapeHtml(team2.name)}</span>
        `;
    }

    const statusLabel = status.replace('_', ' ');
    const meta = [
        `<span class="activity-chip activity-chip-status-${status}">${statusLabel}</span>`,
        rounds ? `<span class="activity-chip">${rounds} ${rounds === 1 ? 'round' : 'rounds'}</span>` : '',
    ].filter(Boolean).join('');

    return `
        <button type="button" class="activity-card" data-match-id="${match.id}"
                style="--band-1:${c1}; --band-2:${c2}">
            <span class="activity-band" style="--band-color:${c1}"></span>
            <span class="activity-band" style="--band-color:${c2}"></span>
            <span class="activity-body">
                <span class="activity-score-line">${scoreLine}</span>
                <span class="activity-meta">${meta}</span>
            </span>
            <span class="activity-date">${DateUtils.formatDateTime(match.date)}</span>
        </button>
    `;
}

function renderMatchChips(summary) {
    if (!summary || !summary.totalRounds) return '';
    const chips = [];
    chips.push(`<span class="mc-chip">${summary.totalRounds} ${summary.totalRounds === 1 ? 'round' : 'rounds'}</span>`);
    if (summary.blinds > 0) {
        chips.push(`<span class="mc-chip mc-chip-blinds">★ ${summary.blinds} blind${summary.blinds === 1 ? '' : 's'}</span>`);
    }
    if (summary.overExtensions > 0) {
        chips.push(`<span class="mc-chip mc-chip-over">${summary.overExtensions} over-ext</span>`);
    }
    if (summary.biggestSwing && summary.biggestSwing.delta > 0) {
        chips.push(`<span class="mc-chip mc-chip-swing">swing ${summary.biggestSwing.delta} (R${summary.biggestSwing.round})</span>`);
    }
    return `<div class="match-chips">${chips.join('')}</div>`;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function wireActivityCards() {
    document.querySelectorAll('.activity-card[data-match-id]').forEach(card => {
        if (card.dataset.wired) return;
        card.dataset.wired = '1';
        card.addEventListener('click', () => {
            const id = card.dataset.matchId;
            showSection('matches');
            requestAnimationFrame(() => {
                const target = document.querySelector(`.match-card[data-match-id="${id}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('match-card-flash');
                    setTimeout(() => target.classList.remove('match-card-flash'), 1600);
                }
            });
        });
    });
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

function renderTeamMatchesTab(profile, allTeams, opponentFilter) {
    const filtered = opponentFilter
        ? profile.allMatches.filter(m => StatsUtils.opponentId(m, profile.id) === String(opponentFilter))
        : profile.allMatches;

    const oppName = opponentFilter
        ? (allTeams.find(t => String(t.id) === String(opponentFilter))?.name || opponentFilter)
        : null;

    const filterChip = opponentFilter
        ? `<div class="td-filter-bar">
               <span class="td-filter-label">Filtered to matches vs <strong>${oppName}</strong></span>
               <button class="td-filter-clear" data-clear-filter>Show all matches</button>
           </div>`
        : '';

    if (!filtered.length) {
        return `${filterChip}<p class="td-empty">${opponentFilter ? `No matches vs ${oppName} yet.` : 'No matches yet.'}</p>`;
    }

    const rows = filtered.map(m => {
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
        ${filterChip}
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
    const c1 = StatsUtils.teamColor(profile.id);
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

function wireTeamTabs(profile, allTeams, matches, initialFilter) {
    let currentFilter = initialFilter || null;
    const tabs = document.querySelectorAll('.td-tab');

    function renderTab(target) {
        const body = document.getElementById('teamDetailsBody');
        if (target === 'overview') body.innerHTML = renderTeamOverview(profile, allTeams, matches);
        else if (target === 'matches') {
            body.innerHTML = renderTeamMatchesTab(profile, allTeams, currentFilter);
            const clear = body.querySelector('[data-clear-filter]');
            if (clear) clear.addEventListener('click', () => { currentFilter = null; renderTab('matches'); });
        }
        else if (target === 'trends') {
            body.innerHTML = renderTeamTrendsTab(profile);
            requestAnimationFrame(() => mountTeamCharts(profile, matches));
        }
    }

    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabs.forEach(t => t.classList.toggle('active', t === btn));
            // Clear opponent filter when manually switching tabs
            if (target !== 'matches') currentFilter = null;
            renderTab(target);
        });
    });

    // If we opened pre-filtered to the matches tab, re-render once through renderTab
    // so the "Show all matches" button gets its click listener wired.
    if (currentFilter) renderTab('matches');
}

async function viewTeamDetails(teamId, opponentId) {
    const allTeams = await teamService.getAllTeams();
    const matches = await matchService.getAllMatches();
    const profile = StatsUtils.teamProfile(teamId, allTeams, matches);
    if (!profile) {
        showModal('<p>Team not found.</p>');
        return;
    }

    const startTab = opponentId ? 'matches' : 'overview';
    const initialBody = startTab === 'matches'
        ? renderTeamMatchesTab(profile, allTeams, String(opponentId))
        : renderTeamOverview(profile, allTeams, matches);

    const fullTeam = allTeams.find(t => String(t.id) === String(profile.id)) || { id: profile.id, name: profile.name };
    const tdMark = (typeof TeamMark !== 'undefined')
        ? TeamMark.render(fullTeam, { size: 'md' })
        : `<span class="team-dot" style="background:${StatsUtils.teamColor(profile.id)}"></span>`;
    showModal(`
        <div class="team-details-modal">
            <div class="td-header" style="border-left: 4px solid ${StatsUtils.teamColor(profile.id)}; padding-left: 14px;">
                <h2 style="display:flex; align-items:center; gap:12px;">${tdMark}<span>${profile.name}</span>
                    <button type="button" id="tdEditTheme" class="action-btn secondary" style="margin-left:auto; font-size:12px; padding:6px 12px;">✎ Theme</button>
                </h2>
                <div class="td-meta">
                    ${profile.members.length ? profile.members.map(m => `<span class="td-member">${m}</span>`).join('') : '<span class="td-empty">No members listed</span>'}
                </div>
            </div>
            <div class="td-tabs">
                <button class="td-tab ${startTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
                <button class="td-tab ${startTab === 'matches' ? 'active' : ''}" data-tab="matches">Matches</button>
                <button class="td-tab" data-tab="trends">Trends</button>
            </div>
            <div id="teamDetailsBody">${initialBody}</div>
        </div>
    `);

    wireTeamTabs(profile, allTeams, matches, opponentId ? String(opponentId) : null);

    const themeBtn = document.getElementById('tdEditTheme');
    if (themeBtn && typeof ThemePicker !== 'undefined') {
        themeBtn.addEventListener('click', () => ThemePicker.open(fullTeam));
    }
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

    // Blind state comes from a checkbox in the legacy modal form but a hidden
    // input (value "1"/"0") on the Game Board — .checked is always false there.
    const readBlind = (team) => {
        const el = document.getElementById(`${team}Blind${matchId}`);
        if (!el) return false;
        return el.type === 'checkbox' ? el.checked : el.value === '1';
    };
    const team1Blind = readBlind('team1');
    const team2Blind = readBlind('team2');

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

    // Snapshot the pre-round state so the audio layer can tell what this round
    // changed (lead flips, match point crossed) — ai-commentary.md § Spoken.
    let beforeRound = null;
    if (typeof AudioCommentary !== 'undefined' && AudioCommentary.isEnabled()) {
        try { beforeRound = await matchService.getMatchDetails(matchId); }
        catch (e) { beforeRound = null; }
    }

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

        // Reveal: pull the now-updated match so we narrate from the latest
        // round and have the right completed-status to trigger the winner moment.
        const updated = await matchService.getMatchDetails(matchId);
        const teams = [updated.teams?.team1, updated.teams?.team2].filter(Boolean);

        if (typeof RoundReveal !== 'undefined') {
            await RoundReveal.show(updated, teams);
        }

        // Narrate the round. Fire-and-forget: the table shouldn't wait on
        // speech synthesis, and audio never blocks the round submission.
        if (typeof AudioCommentary !== 'undefined' && AudioCommentary.isEnabled()) {
            matchService.getAllMatches()
                .then(all => AudioCommentary.announceRound(updated, beforeRound, teams, all))
                .catch(() => { /* audio never blocks the round */ });
        }

        await refreshMatchesList();
        await refreshStats();

        if (updated.status === 'completed' && typeof WinnerMoment !== 'undefined') {
            WinnerMoment.show(updated, teams);
        } else {
            showNotification('Round added successfully!');
        }
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

        // Opening line — sets the scene from head-to-head, streaks and odds.
        if (typeof AudioCommentary !== 'undefined' && AudioCommentary.isEnabled()) {
            Promise.all([matchService.getMatchDetails(matchId), matchService.getAllMatches()])
                .then(([detail, all]) => {
                    const teams = [detail.teams?.team1, detail.teams?.team2].filter(Boolean);
                    return AudioCommentary.announceMatchStart(detail, teams, all);
                })
                .catch(() => { /* audio never blocks the match */ });
        }

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
                'stats.roundsLost': 0,
                // matchHistory must be cleared too: updateTeamStats re-appends an
                // entry per match, so leaving it duplicates history on every recalc
                'matchHistory': []
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

    if (typeof SpectatorPass !== 'undefined') SpectatorPass.init();

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

// Legacy live-recalculate for the older modal round form. The current
// per-match Game Board (js/components/gameBoard.js) owns its own scoring
// preview and writes hidden-input values directly, so this function should
// be a no-op there. We detect the Game Board case by checking whether the
// Blind input is a checkbox (legacy) vs a hidden input (Game Board).
// Scoring follows CLAUDE.md §4.
function recalcRoundScores(matchId) {
    for (const team of ['team1', 'team2']) {
        const blindEl = document.getElementById(`${team}Blind${matchId}`);
        const promiseEl = document.getElementById(`${team}Promise${matchId}`);
        const actualEl = document.getElementById(`${team}Actual${matchId}`);
        const scoreEl = document.getElementById(`${team}Score${matchId}`);
        if (!blindEl || !promiseEl || !actualEl || !scoreEl) return;
        // Game Board owns these fields — bail out so we don't clobber them.
        if (blindEl.type !== 'checkbox') return;

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