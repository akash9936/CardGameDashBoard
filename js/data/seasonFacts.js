/**
 * Season Facts — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  npm run season-facts
 * Source: scripts/season-facts.js  +  js/utils/seasonDigest.js
 *
 * Every number here was computed deterministically from the match archive;
 * the prose was phrased by Groq and verified number-by-number against that
 * archive before being written. See scripts/season-facts.js § verifyLine.
 */
const SeasonFacts = {
    "generatedAt": "2026-08-15T00:37:26.269Z",
    "source": "db-dump/backup-2026-08-11_00-08-39",
    "model": null,
    "roastIntensity": 2,
    "coverage": {
        "matches": 64,
        "rounds": 599,
        "teams": 13
    },
    "facts": [
        {
            "id": "season-scale",
            "icon": "🃏",
            "label": "The season so far",
            "text": "64 matches, 599 rounds and 7,787 hands dealt across 13 teams — 342 of those promises were called blind, and 26% of all round-sides ended negative.",
            "tail": "shaanti se nikal gaya round",
            "intent": "quiet_round",
            "ai": false
        },
        {
            "id": "longest-match",
            "icon": "⏳",
            "label": "Longest match",
            "text": "KorbaGang vs Gaurav/Akash went 15 rounds (July 2026) before anyone reached 500, finishing 528 to 322 — the league average is 9.3 rounds.",
            "tail": "maang zyada, maal kam",
            "intent": "bids_collide",
            "ai": false
        },
        {
            "id": "shortest-match",
            "icon": "⚡",
            "label": "Fastest finish",
            "text": "AlphaStark vs SkySage was over in 6 rounds (June 2025), 564 to 373 — against a league average of 9.3.",
            "tail": "haath badhao aur le lo",
            "intent": "match_point",
            "ai": false
        },
        {
            "id": "closest-finish",
            "icon": "😮‍💨",
            "label": "Closest finish",
            "text": "Gaurav/Akash vs KorbaGang came down to 1 point (August 2026) — 500 to 499 after 9 rounds.",
            "tail": "ek haath ne poora promise kha liya",
            "intent": "one_hand_short",
            "ai": false
        },
        {
            "id": "biggest-blowout",
            "icon": "🪓",
            "label": "Biggest hiding",
            "text": "KorbaGang put 763 points between themselves and Propellers (May 2026), finishing 544 to minus 219 over 11 rounds.",
            "tail": "nipat gaye",
            "intent": "collapse",
            "ai": false
        },
        {
            "id": "biggest-comeback",
            "icon": "🔄",
            "label": "Biggest comeback",
            "text": "Alegeus stars trailed Gaurav/Akash by 337 points (July 2025) and still won it 522 to 361 in 8 rounds.",
            "tail": "scene palat diya",
            "intent": "comeback",
            "ai": false
        },
        {
            "id": "record-total",
            "icon": "🏔️",
            "label": "Record total",
            "text": "Gaurav/Akash closed a match on 620 points (January 2026) — 341 for the opposition, and all of it in just 8 rounds.",
            "tail": "ab rokna mushkil hai",
            "intent": "domination",
            "ai": false
        },
        {
            "id": "best-round",
            "icon": "🚀",
            "label": "Best single round",
            "text": "KorbaGang banked 140 in round 7 against skybhola — called blind, and it landed (July 2026); skybhola took -40 in the same round.",
            "tail": "aankhein band, result solid",
            "intent": "blind_paid_off",
            "ai": false
        },
        {
            "id": "worst-round",
            "icon": "💀",
            "label": "Worst single round",
            "text": "sagealpha promised 10, took 7, and paid -100 for it in round 4 against skybhola (June 2026) — and still went on to win the match.",
            "tail": "nazar aage thi, patte peeche",
            "intent": "greedy_read",
            "ai": false
        },
        {
            "id": "biggest-swing",
            "icon": "⚡",
            "label": "Biggest single-round swing",
            "text": "A single round swung 210 points (July 2026): KorbaGang scored 140 in round 9 while skybhola came away with -70.",
            "tail": "lagataar chal raha hai",
            "intent": "domination",
            "ai": false
        },
        {
            "id": "blind-economy",
            "icon": "🕶️",
            "label": "The blind economy",
            "text": "342 blind calls have been made; 247 landed (72%), for a net +27,930 points across the league.",
            "tail": "bina dekhe bhi ban gaya",
            "intent": "blind_paid_off",
            "ai": false
        },
        {
            "id": "blind-ace",
            "icon": "🎯",
            "label": "Blind specialists",
            "text": "SkySage are the coldest blind callers going — 21 of 21 landed (100%), worth +2,940 points.",
            "tail": "daav chal gaya",
            "intent": "blind_paid_off",
            "ai": false
        },
        {
            "id": "blind-liability",
            "icon": "🙈",
            "label": "Blind liability",
            "text": "skybhola keep reaching for the blind and keep missing — 3 of 5 landed (60%).",
            "tail": "gamble fail, seedha minus",
            "intent": "blind_backfired",
            "ai": false
        },
        {
            "id": "promise-economics",
            "icon": "📈",
            "label": "What a promise is worth",
            "text": "A promise of 8 is the sweet spot at 67.9 points a round; a promise of 7 averages -7.9.",
            "tail": "bid nahi ki thi, loan le liya tha",
            "intent": "greedy_read",
            "ai": false
        },
        {
            "id": "top-rivalry",
            "icon": "⚔️",
            "label": "The great rivalry",
            "text": "Gaurav/Akash vs KorbaGang have met 39 times — it stands Gaurav/Akash 23–16 KorbaGang.",
            "tail": "dono ka hisaab table se bada hai",
            "intent": "bids_collide",
            "ai": false
        },
        {
            "id": "one-sided-rivalry",
            "icon": "💪",
            "label": "Nemesis",
            "text": "Alegeus stars 3–1 Gaurav/Akash — the most one-sided rivalry in the league.",
            "tail": "kaam bolta hai inka",
            "intent": "domination",
            "ai": false
        },
        {
            "id": "win-streak",
            "icon": "🔥",
            "label": "Longest win streak",
            "text": "Gaurav/Akash once won 5 matches in a row.",
            "tail": "sabse aage hain",
            "intent": "domination",
            "ai": false
        },
        {
            "id": "promise-streak",
            "icon": "🤝",
            "label": "Longest promise streak",
            "text": "Gaurav/Akash kept 29 promises in a row without a single negative round.",
            "tail": "aaj inka din hai",
            "intent": "domination",
            "ai": false
        },
        {
            "id": "boldest-team",
            "icon": "🎲",
            "label": "Boldest bidders",
            "text": "Alegeus stars promise 5.8 hands a round on average — the boldest bidders with 30+ rounds played.",
            "tail": "khud ki bid mein khud hi phas gaya",
            "intent": "greedy_read",
            "ai": false
        },
        {
            "id": "most-reliable",
            "icon": "🛡️",
            "label": "Most reliable",
            "text": "AlphaStark keep 78% of their promises — the most dependable side in the league.",
            "tail": "poora control tha inka",
            "intent": "verdict_win",
            "ai": false
        },
        {
            "id": "odd-favourite-promise",
            "icon": "🔍",
            "label": "Did you know",
            "text": "4 is the most-promised number in the league — called 292 times.",
            "tail": "aaj koi panga nahi liya",
            "intent": "quiet_round",
            "ai": false
        },
        {
            "id": "odd-exact-hits",
            "icon": "🔍",
            "label": "Did you know",
            "text": "139 of 1198 round-sides landed exactly on the promised number, not one hand more.",
            "tail": "ek toh aaj marega, dekhte hain kaun",
            "intent": "bids_collide",
            "ai": false
        },
        {
            "id": "odd-all-thirteen",
            "icon": "🔍",
            "label": "Did you know",
            "text": "One team has swept all 13 hands in a single round — which under the rules is a penalty, not a triumph.",
            "tail": "cards ne chhodne hi nahi diye",
            "intent": "cursed_hand",
            "ai": false
        },
        {
            "id": "odd-zero-hands",
            "icon": "🔍",
            "label": "Did you know",
            "text": "2 round-sides have ended with zero hands taken.",
            "tail": "thoda zyada soch liya",
            "intent": "greedy_read",
            "ai": false
        },
        {
            "id": "odd-seven-open-eyed",
            "icon": "🔍",
            "label": "Did you know",
            "text": "7 has been promised open-eyed 196 times, rather than taking the blind at the very same number.",
            "tail": "wo ek haath saamne wale ke paas hai",
            "intent": "one_hand_short",
            "ai": false
        },
        {
            "id": "odd-first-team-edge",
            "icon": "🔍",
            "label": "Did you know",
            "text": "The team listed first has won 32 of 64 decided matches.",
            "tail": "band baj gayi",
            "intent": "collapse",
            "ai": false
        },
        {
            "id": "odd-typical-length",
            "icon": "🔍",
            "label": "Did you know",
            "text": "The typical match runs 9 rounds — 23 have gone longer.",
            "tail": "seedha saada round",
            "intent": "quiet_round",
            "ai": false
        },
        {
            "id": "odd-bloodiest-round",
            "icon": "🔍",
            "label": "Did you know",
            "text": "Round 9 is the cruellest slot in a match — 38% of promises made there ended negative.",
            "tail": "table pe itne haath hai hi nahi",
            "intent": "bids_collide",
            "ai": false
        }
    ],
    "digest": {
        "generatedFrom": {
            "teams": 15,
            "matches": 89,
            "excludedTeams": 2,
            "excludedMatches": 6
        },
        "overview": {
            "teams": 13,
            "matchesCompleted": 64,
            "matchesTotal": 83,
            "rounds": 599,
            "handsDealt": 7787,
            "blindsCalled": 342,
            "blindRatePct": 29,
            "negativeRounds": 309,
            "negativeRatePct": 26,
            "overExtensions": 10,
            "firstMatchDate": "2025-05-24T18:30:00.000Z",
            "lastMatchDate": "2026-08-10T12:58:32.616Z"
        },
        "teams": [
            {
                "team": "Gaurav/Akash",
                "played": 43,
                "wins": 24,
                "losses": 19,
                "winPct": 56,
                "totalScore": 17015,
                "avgMatchScore": 396,
                "avgRoundScore": 41.8,
                "rounds": 407,
                "avgPromise": 5.3,
                "avgActual": 6.5,
                "boldestPromise": 8,
                "safestPromise": 4,
                "promisesKeptPct": 76,
                "roundsNegative": 98,
                "overExtensions": 2,
                "blindsCalled": 104,
                "blindsLanded": 74,
                "blindHitPct": 71,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 8,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 4,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "currentStreak": null
            },
            {
                "team": "KorbaGang",
                "played": 47,
                "wins": 20,
                "losses": 27,
                "winPct": 43,
                "totalScore": 18439,
                "avgMatchScore": 392,
                "avgRoundScore": 41.4,
                "rounds": 445,
                "avgPromise": 5.5,
                "avgActual": 6.5,
                "boldestPromise": 9,
                "safestPromise": 4,
                "promisesKeptPct": 73,
                "roundsNegative": 122,
                "overExtensions": 6,
                "blindsCalled": 143,
                "blindsLanded": 94,
                "blindHitPct": 66,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 10,
                    "blind": true,
                    "vs": "skybhola"
                },
                "worstRound": {
                    "score": -80,
                    "promise": 8,
                    "actual": 6,
                    "blind": false,
                    "vs": "Gaurav/Akash"
                },
                "currentStreak": null
            },
            {
                "team": "SkySage",
                "played": 10,
                "wins": 5,
                "losses": 5,
                "winPct": 50,
                "totalScore": 4106,
                "avgMatchScore": 411,
                "avgRoundScore": 44.6,
                "rounds": 92,
                "avgPromise": 5.5,
                "avgActual": 6.5,
                "boldestPromise": 9,
                "safestPromise": 4,
                "promisesKeptPct": 75,
                "roundsNegative": 23,
                "overExtensions": 2,
                "blindsCalled": 21,
                "blindsLanded": 21,
                "blindHitPct": 100,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 10,
                    "blind": true,
                    "vs": "AlphaStark"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 5,
                    "blind": false,
                    "vs": "AlphaStark"
                },
                "currentStreak": null
            },
            {
                "team": "AlphaStark",
                "played": 9,
                "wins": 5,
                "losses": 4,
                "winPct": 56,
                "totalScore": 3988,
                "avgMatchScore": 443,
                "avgRoundScore": 48,
                "rounds": 83,
                "avgPromise": 5.3,
                "avgActual": 6.5,
                "boldestPromise": 8,
                "safestPromise": 4,
                "promisesKeptPct": 78,
                "roundsNegative": 18,
                "overExtensions": 0,
                "blindsCalled": 20,
                "blindsLanded": 20,
                "blindHitPct": 100,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 8,
                    "blind": true,
                    "vs": "SkySage"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 2,
                    "blind": false,
                    "vs": "SkySage"
                },
                "currentStreak": "2 wins"
            },
            {
                "team": "Alegeus stars",
                "played": 6,
                "wins": 3,
                "losses": 3,
                "winPct": 50,
                "totalScore": 1834,
                "avgMatchScore": 306,
                "avgRoundScore": 36,
                "rounds": 51,
                "avgPromise": 5.8,
                "avgActual": 6.1,
                "boldestPromise": 8,
                "safestPromise": 4,
                "promisesKeptPct": 63,
                "roundsNegative": 19,
                "overExtensions": 0,
                "blindsCalled": 20,
                "blindsLanded": 16,
                "blindHitPct": 80,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 7,
                    "blind": true,
                    "vs": "Gaurav/Akash"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 6,
                    "blind": true,
                    "vs": "Gaurav/Akash"
                },
                "currentStreak": null
            },
            {
                "team": "Sky/K2",
                "played": 2,
                "wins": 2,
                "losses": 0,
                "winPct": 100,
                "totalScore": 1145,
                "avgMatchScore": 573,
                "avgRoundScore": 76.3,
                "rounds": 15,
                "avgPromise": 5.2,
                "avgActual": 7.1,
                "boldestPromise": 7,
                "safestPromise": 4,
                "promisesKeptPct": 100,
                "roundsNegative": 0,
                "overExtensions": 0,
                "blindsCalled": 4,
                "blindsLanded": 4,
                "blindHitPct": 100,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 10,
                    "blind": true,
                    "vs": "Gaurav/ Palash"
                },
                "worstRound": {
                    "score": 40,
                    "promise": 4,
                    "actual": 4,
                    "blind": false,
                    "vs": "Alegeus stars"
                },
                "currentStreak": "2 wins"
            },
            {
                "team": "Propellers",
                "played": 3,
                "wins": 2,
                "losses": 1,
                "winPct": 67,
                "totalScore": 805,
                "avgMatchScore": 268,
                "avgRoundScore": 25.2,
                "rounds": 32,
                "avgPromise": 5.4,
                "avgActual": 6.5,
                "boldestPromise": 8,
                "safestPromise": 4,
                "promisesKeptPct": 66,
                "roundsNegative": 11,
                "overExtensions": 0,
                "blindsCalled": 12,
                "blindsLanded": 5,
                "blindHitPct": 42,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 10,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 6,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "currentStreak": "2 wins"
            },
            {
                "team": "Jake/sky",
                "played": 2,
                "wins": 1,
                "losses": 1,
                "winPct": 50,
                "totalScore": 960,
                "avgMatchScore": 480,
                "avgRoundScore": 60,
                "rounds": 16,
                "avgPromise": 5.6,
                "avgActual": 6.4,
                "boldestPromise": 8,
                "safestPromise": 4,
                "promisesKeptPct": 88,
                "roundsNegative": 2,
                "overExtensions": 0,
                "blindsCalled": 3,
                "blindsLanded": 3,
                "blindHitPct": 100,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 7,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "worstRound": {
                    "score": -60,
                    "promise": 6,
                    "actual": 5,
                    "blind": false,
                    "vs": "KorbaGang"
                },
                "currentStreak": null
            },
            {
                "team": "K2-G",
                "played": 1,
                "wins": 1,
                "losses": 0,
                "winPct": 100,
                "totalScore": 519,
                "avgMatchScore": 519,
                "avgRoundScore": 64.9,
                "rounds": 8,
                "avgPromise": 5.4,
                "avgActual": 8,
                "boldestPromise": 7,
                "safestPromise": 4,
                "promisesKeptPct": 100,
                "roundsNegative": 0,
                "overExtensions": 0,
                "blindsCalled": 0,
                "blindsLanded": 0,
                "blindHitPct": null,
                "bestRound": {
                    "score": 74,
                    "promise": 7,
                    "actual": 11,
                    "blind": false,
                    "vs": "Alegeus stars"
                },
                "worstRound": {
                    "score": 41,
                    "promise": 4,
                    "actual": 5,
                    "blind": false,
                    "vs": "Alegeus stars"
                },
                "currentStreak": null
            },
            {
                "team": "sagealpha",
                "played": 1,
                "wins": 1,
                "losses": 0,
                "winPct": 100,
                "totalScore": 507,
                "avgMatchScore": 507,
                "avgRoundScore": 42.3,
                "rounds": 12,
                "avgPromise": 6,
                "avgActual": 6.9,
                "boldestPromise": 10,
                "safestPromise": 4,
                "promisesKeptPct": 67,
                "roundsNegative": 4,
                "overExtensions": 0,
                "blindsCalled": 6,
                "blindsLanded": 4,
                "blindHitPct": 67,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 7,
                    "blind": true,
                    "vs": "skybhola"
                },
                "worstRound": {
                    "score": -100,
                    "promise": 10,
                    "actual": 7,
                    "blind": false,
                    "vs": "skybhola"
                },
                "currentStreak": null
            },
            {
                "team": "skybhola",
                "played": 2,
                "wins": 0,
                "losses": 2,
                "winPct": 0,
                "totalScore": 711,
                "avgMatchScore": 356,
                "avgRoundScore": 33.9,
                "rounds": 21,
                "avgPromise": 5.2,
                "avgActual": 6.4,
                "boldestPromise": 7,
                "safestPromise": 4,
                "promisesKeptPct": 71,
                "roundsNegative": 6,
                "overExtensions": 0,
                "blindsCalled": 5,
                "blindsLanded": 3,
                "blindHitPct": 60,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 7,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 6,
                    "blind": false,
                    "vs": "KorbaGang"
                },
                "currentStreak": "2 losses"
            },
            {
                "team": "SageStark",
                "played": 1,
                "wins": 0,
                "losses": 1,
                "winPct": 0,
                "totalScore": 385,
                "avgMatchScore": 385,
                "avgRoundScore": 48.1,
                "rounds": 8,
                "avgPromise": 5,
                "avgActual": 6.3,
                "boldestPromise": 7,
                "safestPromise": 4,
                "promisesKeptPct": 75,
                "roundsNegative": 2,
                "overExtensions": 0,
                "blindsCalled": 3,
                "blindsLanded": 2,
                "blindHitPct": 67,
                "bestRound": {
                    "score": 140,
                    "promise": 7,
                    "actual": 8,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "worstRound": {
                    "score": -70,
                    "promise": 7,
                    "actual": 6,
                    "blind": true,
                    "vs": "KorbaGang"
                },
                "currentStreak": null
            }
        ],
        "promiseBands": [
            {
                "promise": 4,
                "called": 292,
                "metPct": 78,
                "bustPct": 2,
                "avgPoints": 23.4
            },
            {
                "promise": 5,
                "called": 181,
                "metPct": 88,
                "bustPct": 2,
                "avgPoints": 39.4
            },
            {
                "promise": 6,
                "called": 158,
                "metPct": 92,
                "bustPct": 1,
                "avgPoints": 51.9
            },
            {
                "promise": 7,
                "called": 196,
                "metPct": 43,
                "bustPct": 0,
                "avgPoints": -7.9
            },
            {
                "promise": 8,
                "called": 24,
                "metPct": 92,
                "bustPct": 0,
                "avgPoints": 67.9
            },
            {
                "promise": 9,
                "called": 4,
                "metPct": 100,
                "bustPct": 0,
                "avgPoints": 91.3
            },
            {
                "promise": 10,
                "called": 1,
                "metPct": 0,
                "bustPct": 0,
                "avgPoints": -100
            }
        ],
        "blinds": {
            "called": 342,
            "landed": 247,
            "hitPct": 72,
            "netPoints": 27930,
            "byTeam": [
                {
                    "team": "SkySage",
                    "called": 21,
                    "landed": 21,
                    "hitPct": 100,
                    "netPoints": 2940
                },
                {
                    "team": "AlphaStark",
                    "called": 20,
                    "landed": 20,
                    "hitPct": 100,
                    "netPoints": 2800
                },
                {
                    "team": "Sky/K2",
                    "called": 4,
                    "landed": 4,
                    "hitPct": 100,
                    "netPoints": 560
                },
                {
                    "team": "Jake/sky",
                    "called": 3,
                    "landed": 3,
                    "hitPct": 100,
                    "netPoints": 420
                },
                {
                    "team": "Alegeus stars",
                    "called": 20,
                    "landed": 16,
                    "hitPct": 80,
                    "netPoints": 1960
                },
                {
                    "team": "Gaurav/Akash",
                    "called": 104,
                    "landed": 74,
                    "hitPct": 71,
                    "netPoints": 8260
                },
                {
                    "team": "sagealpha",
                    "called": 6,
                    "landed": 4,
                    "hitPct": 67,
                    "netPoints": 420
                },
                {
                    "team": "SageStark",
                    "called": 3,
                    "landed": 2,
                    "hitPct": 67,
                    "netPoints": 210
                },
                {
                    "team": "KorbaGang",
                    "called": 143,
                    "landed": 94,
                    "hitPct": 66,
                    "netPoints": 9730
                },
                {
                    "team": "skybhola",
                    "called": 5,
                    "landed": 3,
                    "hitPct": 60,
                    "netPoints": 280
                }
            ]
        },
        "records": {
            "averageMatchLength": 9.3,
            "longestMatch": {
                "rounds": 15,
                "match": "KorbaGang vs Gaurav/Akash",
                "date": "July 2026",
                "winner": "KorbaGang",
                "winningScore": 528,
                "losingScore": 322,
                "avgRounds": 9.3
            },
            "shortestMatch": {
                "rounds": 6,
                "match": "AlphaStark vs SkySage",
                "date": "June 2025",
                "winner": "AlphaStark",
                "winningScore": 564,
                "losingScore": 373,
                "avgRounds": 9.3
            },
            "highestFinalScore": {
                "score": 620,
                "team": "Gaurav/Akash",
                "match": "KorbaGang vs Gaurav/Akash",
                "date": "January 2026",
                "opponentScore": 341,
                "rounds": 8
            },
            "closestFinish": {
                "margin": 1,
                "match": "Gaurav/Akash vs KorbaGang",
                "date": "August 2026",
                "winner": "Gaurav/Akash",
                "winningScore": 500,
                "losingScore": 499,
                "rounds": 9
            },
            "biggestBlowout": {
                "margin": 763,
                "match": "KorbaGang vs Propellers",
                "date": "May 2026",
                "winner": "KorbaGang",
                "winningScore": 544,
                "losingScore": -219,
                "rounds": 11
            },
            "bestSingleRound": {
                "score": 140,
                "team": "KorbaGang",
                "vs": "skybhola",
                "promise": 7,
                "actual": 10,
                "blind": true,
                "round": 7,
                "opponentScore": -40,
                "wonTheMatch": true,
                "date": "July 2026"
            },
            "worstSingleRound": {
                "score": -100,
                "team": "sagealpha",
                "vs": "skybhola",
                "promise": 10,
                "actual": 7,
                "blind": false,
                "round": 4,
                "opponentScore": -70,
                "wonTheMatch": true,
                "date": "June 2026"
            },
            "biggestRoundSwing": {
                "swing": 210,
                "team": "KorbaGang",
                "vs": "skybhola",
                "promise": 7,
                "actual": 7,
                "blind": true,
                "round": 9,
                "opponentScore": -70,
                "wonTheMatch": true,
                "date": "July 2026",
                "score": 140
            },
            "biggestComeback": {
                "deficit": 337,
                "team": "Alegeus stars",
                "opponent": "Gaurav/Akash",
                "match": "Alegeus stars vs Gaurav/Akash",
                "finalScore": 522,
                "opponentScore": 361,
                "rounds": 8,
                "date": "July 2025"
            }
        },
        "rivalries": [
            {
                "pair": "Gaurav/Akash vs KorbaGang",
                "meetings": 39,
                "record": "Gaurav/Akash 23–16 KorbaGang",
                "leader": "Gaurav/Akash",
                "dominance": 59,
                "avgRounds": 9.5
            },
            {
                "pair": "AlphaStark vs SkySage",
                "meetings": 9,
                "record": "AlphaStark 5–4 SkySage",
                "leader": "AlphaStark",
                "dominance": 56,
                "avgRounds": 9.2
            },
            {
                "pair": "Gaurav/Akash vs Alegeus stars",
                "meetings": 4,
                "record": "Alegeus stars 3–1 Gaurav/Akash",
                "leader": "Alegeus stars",
                "dominance": 75,
                "avgRounds": 9
            },
            {
                "pair": "KorbaGang vs Propellers",
                "meetings": 3,
                "record": "Propellers 2–1 KorbaGang",
                "leader": "Propellers",
                "dominance": 67,
                "avgRounds": 10.7
            },
            {
                "pair": "KorbaGang vs Jake/sky",
                "meetings": 2,
                "record": "KorbaGang 1–1 Jake/sky",
                "leader": null,
                "dominance": 50,
                "avgRounds": 8
            }
        ],
        "streaks": {
            "longestWinStreak": {
                "team": "Gaurav/Akash",
                "count": 5
            },
            "longestLossStreak": {
                "team": "Gaurav/Akash",
                "count": 3
            },
            "longestPromiseStreak": {
                "team": "Gaurav/Akash",
                "count": 29
            }
        },
        "tilt": {
            "league": {
                "afterBadPct": 65,
                "afterGoodPct": 21,
                "badSample": 257,
                "goodSample": 813
            },
            "byTeam": [
                {
                    "team": "KorbaGang",
                    "afterBadPct": 74,
                    "afterGoodPct": 22,
                    "tiltIndex": 52,
                    "sample": 101,
                    "escalatePct": 31
                },
                {
                    "team": "AlphaStark",
                    "afterBadPct": 67,
                    "afterGoodPct": 15,
                    "tiltIndex": 52,
                    "sample": 15,
                    "escalatePct": 40
                },
                {
                    "team": "Gaurav/Akash",
                    "afterBadPct": 60,
                    "afterGoodPct": 18,
                    "tiltIndex": 42,
                    "sample": 84,
                    "escalatePct": 39
                },
                {
                    "team": "SkySage",
                    "afterBadPct": 56,
                    "afterGoodPct": 17,
                    "tiltIndex": 39,
                    "sample": 18,
                    "escalatePct": 50
                },
                {
                    "team": "Alegeus stars",
                    "afterBadPct": 50,
                    "afterGoodPct": 41,
                    "tiltIndex": 9,
                    "sample": 16,
                    "escalatePct": 0
                }
            ],
            "hottest": {
                "team": "KorbaGang",
                "afterBadPct": 74,
                "afterGoodPct": 22,
                "tiltIndex": 52,
                "sample": 101,
                "escalatePct": 31
            },
            "coolest": {
                "team": "Alegeus stars",
                "afterBadPct": 50,
                "afterGoodPct": 41,
                "tiltIndex": 9,
                "sample": 16,
                "escalatePct": 0
            }
        },
        "personalities": [
            {
                "team": "Gaurav/Akash",
                "archetype": "Garam dimaag",
                "archetypeId": "tilter",
                "blurb": "Ek round kharab, agla blind.",
                "evidence": "blind rate jumps 18% to 60% after a bad round",
                "traits": {
                    "nerve": 77,
                    "discipline": 76,
                    "blindEye": 71,
                    "coolHead": 58
                },
                "record": "24-19",
                "rounds": 407,
                "avgPromise": 5.3,
                "tiltIndex": 42
            },
            {
                "team": "KorbaGang",
                "archetype": "Blind ka aashiq",
                "archetypeId": "blind_addict",
                "blurb": "Aankhein band, dua qubool.",
                "evidence": "143 blinds called, only 66% landed",
                "traits": {
                    "nerve": 96,
                    "discipline": 73,
                    "blindEye": 66,
                    "coolHead": 48
                },
                "record": "20-27",
                "rounds": 445,
                "avgPromise": 5.5,
                "tiltIndex": 52
            },
            {
                "team": "SkySage",
                "archetype": "Ganit ka master",
                "archetypeId": "sniper",
                "blurb": "Counts the cards, then counts the money.",
                "evidence": "75% kept and 21 of 21 blinds landed",
                "traits": {
                    "nerve": 68,
                    "discipline": 75,
                    "blindEye": 100,
                    "coolHead": 61
                },
                "record": "5-5",
                "rounds": 92,
                "avgPromise": 5.5,
                "tiltIndex": 39
            },
            {
                "team": "AlphaStark",
                "archetype": "Ganit ka master",
                "archetypeId": "sniper",
                "blurb": "Counts the cards, then counts the money.",
                "evidence": "78% kept and 20 of 20 blinds landed",
                "traits": {
                    "nerve": 72,
                    "discipline": 78,
                    "blindEye": 100,
                    "coolHead": 48
                },
                "record": "5-4",
                "rounds": 83,
                "avgPromise": 5.3,
                "tiltIndex": 52
            },
            {
                "team": "Alegeus stars",
                "archetype": "Jugaadu",
                "archetypeId": "gambler",
                "blurb": "Plan B hi Plan A hai.",
                "evidence": "promises 5.8 a round but keeps only 63%",
                "traits": {
                    "nerve": 100,
                    "discipline": 63,
                    "blindEye": 80,
                    "coolHead": 91
                },
                "record": "3-3",
                "rounds": 51,
                "avgPromise": 5.8,
                "tiltIndex": 9
            },
            {
                "team": "Propellers",
                "archetype": "Table ka pillar",
                "archetypeId": "workhorse",
                "blurb": "Har match mein hai.",
                "evidence": "32 rounds across 3 matches",
                "traits": {
                    "nerve": 100,
                    "discipline": 66,
                    "blindEye": 42,
                    "coolHead": null
                },
                "record": "2-1",
                "rounds": 32,
                "avgPromise": 5.4,
                "tiltIndex": null
            }
        ],
        "oddities": [
            {
                "id": "favourite-promise",
                "stat": "4 is the most-promised number in the league — called 292 times."
            },
            {
                "id": "exact-hits",
                "stat": "139 of 1198 round-sides landed exactly on the promised number, not one hand more."
            },
            {
                "id": "all-thirteen",
                "stat": "One team has swept all 13 hands in a single round — which under the rules is a penalty, not a triumph."
            },
            {
                "id": "zero-hands",
                "stat": "2 round-sides have ended with zero hands taken."
            },
            {
                "id": "seven-open-eyed",
                "stat": "7 has been promised open-eyed 196 times, rather than taking the blind at the very same number."
            },
            {
                "id": "first-team-edge",
                "stat": "The team listed first has won 32 of 64 decided matches."
            },
            {
                "id": "typical-length",
                "stat": "The typical match runs 9 rounds — 23 have gone longer."
            },
            {
                "id": "bloodiest-round",
                "stat": "Round 9 is the cruellest slot in a match — 38% of promises made there ended negative."
            }
        ]
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SeasonFacts;
}
