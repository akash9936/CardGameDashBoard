/**
 * Pure-function statistics computed from raw teams + matches.
 * No Firestore reads, no side effects. Safe to call on every render.
 */
const StatsUtils = (() => {
    function isCompleted(m) { return m.status === 'completed'; }

    function teamIdsOf(m) { return [String(m.team1Id), String(m.team2Id)]; }

    function teamSide(match, teamId) {
        return String(match.team1Id) === String(teamId) ? 'team1' : 'team2';
    }

    function opponentId(match, teamId) {
        return String(match.team1Id) === String(teamId) ? String(match.team2Id) : String(match.team1Id);
    }

    function isBlindSide(side) {
        if (!side) return false;
        if (side.blind === true) return true;
        if (side.blind === false) return false;
        return side.promise === 7 && side.score === 140;
    }

    function kpis(matches) {
        const completed = matches.filter(isCompleted);
        let totalRounds = 0;
        let highestRoundScore = -Infinity;
        let blindsCalled = 0;

        for (const m of matches) {
            const rounds = Array.isArray(m.rounds) ? m.rounds : [];
            totalRounds += rounds.length;
            for (const r of rounds) {
                const s1 = Number(r.team1?.score ?? -Infinity);
                const s2 = Number(r.team2?.score ?? -Infinity);
                if (s1 > highestRoundScore) highestRoundScore = s1;
                if (s2 > highestRoundScore) highestRoundScore = s2;
                if (isBlindSide(r.team1)) blindsCalled++;
                if (isBlindSide(r.team2)) blindsCalled++;
            }
        }

        return {
            totalMatches: completed.length,
            totalRounds,
            highestRoundScore: highestRoundScore === -Infinity ? 0 : highestRoundScore,
            blindsCalled,
        };
    }

    function leaderboard(teams, matches) {
        const rows = teams.map(t => ({
            id: String(t.id),
            name: t.name,
            played: 0, wins: 0, losses: 0,
            points: 0, totalScore: 0,
            roundsWon: 0, roundsLost: 0,
        }));
        const byId = new Map(rows.map(r => [r.id, r]));

        for (const m of matches.filter(isCompleted)) {
            const t1 = byId.get(String(m.team1Id));
            const t2 = byId.get(String(m.team2Id));
            if (!t1 || !t2) continue;

            t1.played++; t2.played++;
            t1.totalScore += Number(m.finalScore?.team1 || 0);
            t2.totalScore += Number(m.finalScore?.team2 || 0);
            t1.roundsWon += Number(m.roundStats?.team1?.won || 0);
            t1.roundsLost += Number(m.roundStats?.team1?.lost || 0);
            t2.roundsWon += Number(m.roundStats?.team2?.won || 0);
            t2.roundsLost += Number(m.roundStats?.team2?.lost || 0);

            if (String(m.winnerId) === t1.id) { t1.wins++; t1.points += 3; t2.losses++; }
            else if (String(m.winnerId) === t2.id) { t2.wins++; t2.points += 3; t1.losses++; }
        }

        for (const r of rows) {
            r.winPct = r.played ? (r.wins / r.played) * 100 : 0;
            r.avgScore = r.played ? r.totalScore / r.played : 0;
        }

        rows.sort((a, b) =>
            b.points - a.points ||
            b.winPct - a.winPct ||
            b.totalScore - a.totalScore ||
            a.name.localeCompare(b.name)
        );
        rows.forEach((r, i) => { r.rank = i + 1; });
        return rows;
    }

    function recentForm(teams, matches, lastN = 5) {
        const completed = matches
            .filter(isCompleted)
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const out = new Map();
        for (const t of teams) {
            const teamId = String(t.id);
            const form = [];
            for (const m of completed) {
                const ids = teamIdsOf(m);
                if (!ids.includes(teamId)) continue;
                form.push(String(m.winnerId) === teamId ? 'W' : 'L');
                if (form.length >= lastN) break;
            }
            out.set(teamId, form);
        }
        return out;
    }

    function cumulativeSeries(match) {
        const rounds = Array.isArray(match.rounds) ? match.rounds.slice() : [];
        rounds.sort((a, b) => a.roundNumber - b.roundNumber);
        const labels = ['Start'];
        const team1 = [0], team2 = [0];
        let t1 = 0, t2 = 0;
        for (const r of rounds) {
            t1 += Number(r.team1?.score || 0);
            t2 += Number(r.team2?.score || 0);
            labels.push(`R${r.roundNumber}`);
            team1.push(t1);
            team2.push(t2);
        }
        return { labels, team1, team2 };
    }

    function roundOutcome(side) {
        if (!side) return 'neutral';
        const score = Number(side.score || 0);
        if (isBlindSide(side)) return score > 0 ? 'blind-success' : 'blind-fail';
        if (score < 0) return 'negative';
        if (score === 0) return 'neutral';
        return 'positive';
    }

    function teamMatches(teamId, matches) {
        const id = String(teamId);
        return matches
            .filter(m => teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function teamProfile(teamId, teams, matches) {
        const id = String(teamId);
        const team = teams.find(t => String(t.id) === id);
        if (!team) return null;
        const all = teamMatches(id, matches);
        const completed = all.filter(isCompleted);

        let wins = 0, losses = 0, totalScore = 0;
        let roundsWon = 0, roundsLost = 0;
        let bestMatchScore = -Infinity, bestMatchId = null;
        const opponentCounts = new Map();

        for (const m of completed) {
            const side = teamSide(m, id);
            const myScore = Number(m.finalScore?.[side] || 0);
            totalScore += myScore;
            roundsWon += Number(m.roundStats?.[side]?.won || 0);
            roundsLost += Number(m.roundStats?.[side]?.lost || 0);
            if (String(m.winnerId) === id) wins++; else if (m.winnerId) losses++;
            if (myScore > bestMatchScore) { bestMatchScore = myScore; bestMatchId = m.id; }
            const opp = opponentId(m, id);
            opponentCounts.set(opp, (opponentCounts.get(opp) || 0) + 1);
        }

        const played = completed.length;
        let topOpponentId = null, topOpponentCount = 0;
        for (const [oid, count] of opponentCounts) {
            if (count > topOpponentCount) { topOpponentId = oid; topOpponentCount = count; }
        }

        return {
            id,
            name: team.name,
            members: Array.isArray(team.members) ? team.members : [],
            played, wins, losses,
            points: wins * 3,
            winPct: played ? (wins / played) * 100 : 0,
            totalScore,
            avgScore: played ? totalScore / played : 0,
            roundsWon, roundsLost,
            bestMatchScore: bestMatchScore === -Infinity ? 0 : bestMatchScore,
            bestMatchId,
            topOpponentId,
            allMatches: all,
        };
    }

    function headToHead(teamId, opponentId, matches) {
        const id = String(teamId), oid = String(opponentId);
        const between = matches.filter(m => {
            const ids = teamIdsOf(m);
            return isCompleted(m) && ids.includes(id) && ids.includes(oid);
        }).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

        let wins = 0, losses = 0;
        for (const m of between) {
            if (String(m.winnerId) === id) wins++;
            else if (m.winnerId) losses++;
        }
        const recent = between.slice(0, 3).map(m => String(m.winnerId) === id ? 'W' : 'L');
        return { played: between.length, wins, losses, recent };
    }

    function teamScoreSeries(teamId, matches) {
        const id = String(teamId);
        const completed = matches
            .filter(m => isCompleted(m) && teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        return completed.map((m, i) => ({
            x: i + 1,
            y: Number(m.finalScore?.[teamSide(m, id)] || 0),
            matchId: m.id,
            date: m.date,
        }));
    }

    function teamPromiseActualPoints(teamId, matches) {
        const id = String(teamId);
        const points = [];
        for (const m of matches) {
            if (!teamIdsOf(m).includes(id)) continue;
            const side = teamSide(m, id);
            for (const r of (m.rounds || [])) {
                const v = r[side];
                if (!v) continue;
                points.push({
                    x: Number(v.promise || 0),
                    y: Number(v.actual || 0),
                    score: Number(v.score || 0),
                    blind: isBlindSide(v),
                });
            }
        }
        return points;
    }

    function currentStreak(teamId, matches) {
        const id = String(teamId);
        const completed = matches
            .filter(m => isCompleted(m) && teamIdsOf(m).includes(id))
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (!completed.length) return { count: 0, type: null };
        const first = String(completed[0].winnerId) === id ? 'W' : 'L';
        let count = 0;
        for (const m of completed) {
            const r = String(m.winnerId) === id ? 'W' : 'L';
            if (r !== first) break;
            count++;
        }
        return { count, type: first };
    }

    function hottestStreak(teams, matches, minCount = 3) {
        let best = null;
        for (const t of teams) {
            const s = currentStreak(t.id, matches);
            if (s.count >= minCount && (!best || s.count > best.count)) {
                best = { teamId: String(t.id), name: t.name, ...s };
            }
        }
        return best;
    }

    function topRoundScore(matches) {
        let best = { score: -Infinity, matchId: null, roundNumber: null, side: null };
        for (const m of matches) {
            for (const r of (m.rounds || [])) {
                for (const side of ['team1', 'team2']) {
                    const s = Number(r[side]?.score || 0);
                    if (s > best.score) {
                        best = { score: s, matchId: m.id, roundNumber: r.roundNumber, side };
                    }
                }
            }
        }
        if (!isFinite(best.score)) return null;
        return best;
    }

    function topRivalry(matches) {
        const counts = new Map();
        for (const m of matches) {
            if (!isCompleted(m)) continue;
            const [a, b] = teamIdsOf(m).slice().sort();
            const key = `${a}|${b}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        let best = null;
        for (const [key, count] of counts) {
            if (!best || count > best.count) {
                const [team1Id, team2Id] = key.split('|');
                best = { team1Id, team2Id, count };
            }
        }
        return best;
    }

    function matchSummary(match) {
        const rounds = Array.isArray(match.rounds) ? match.rounds : [];
        let blinds = 0, overExtensions = 0;
        let biggestSwing = { round: null, delta: 0 };

        for (const r of rounds) {
            for (const side of ['team1', 'team2']) {
                const v = r[side];
                if (!v) continue;
                if (isBlindSide(v)) blinds++;
                const promise = Number(v.promise || 0);
                const actual = Number(v.actual || 0);
                if (promise > 0 && actual >= promise * 2 && !isBlindSide(v)) overExtensions++;
            }
            const delta = Math.abs(Number(r.team1?.score || 0) - Number(r.team2?.score || 0));
            if (delta > biggestSwing.delta) biggestSwing = { round: r.roundNumber, delta };
        }

        return { blinds, overExtensions, biggestSwing, totalRounds: rounds.length };
    }

    return {
        kpis, leaderboard, recentForm, teamSide, opponentId, isBlindSide,
        cumulativeSeries, roundOutcome, matchSummary,
        teamProfile, headToHead, teamScoreSeries, teamPromiseActualPoints, teamMatches,
        currentStreak, hottestStreak, topRoundScore, topRivalry,
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StatsUtils;
}
