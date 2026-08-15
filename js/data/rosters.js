/**
 * Rosters — which people played under which team name.
 *
 * Spec: ai-continuity.md §3. This file is HAND-AUTHORED and deliberately not
 * inferred. 88% of team-slots in the archive (157 of 178) belong to teams
 * whose `members` array is empty, including the two that carry the league:
 * KorbaGang (61 slots) and Gaurav/Akash (55). Nothing in the data records who
 * played, so guessing would invent history rather than recall it.
 *
 * Until a team is filled in here, it simply has no players and every
 * person-level line about it is skipped. Nothing breaks; the feature just
 * stays quiet — which is the correct behaviour for a commentator who does not
 * know who is at the table.
 *
 * HOW TO FILL THIS IN
 *   - Keys are TEAM NAMES exactly as they appear on the team record. Matching
 *     is case-insensitive and whitespace-trimmed, so 'korbagang' also works.
 *   - Values are the people who played under that name.
 *   - Replace every '?' below. Delete a team's entry entirely if you would
 *     rather it stayed anonymous.
 *   - Use ALIASES when one person appears under several spellings, so that
 *     'akash', 'Akash' and 'sky' all resolve to one human.
 *
 * No build step: a plain window global, same pattern as js/data/seasonFacts.js.
 */
(function (root) {
    /**
     * team name → players. '?' means "not yet known" and is treated exactly
     * like a missing entry: the team contributes no person-level facts.
     */
    const ROSTERS = {
        // ── REQUIRED: these two carry the league ────────────────────────────
        'KorbaGang': ['?', '?'],          // 61 match-slots
        'Gaurav/Akash': ['Gaurav', 'Akash'],

        // ── Worth filling: real play, no member data ────────────────────────
        'SkySage': ['?', '?'],            // 11 match-slots
        'AlphaStark': ['?', '?'],         // 10 match-slots
        'Alegeus stars': ['?', '?'],      //  8 match-slots

        // ── Recovered from the teams' own `members` field ───────────────────
        'K2-G': ['Gaurav', 'Kritagya'],
        'Sky/K2': ['Akash', 'Kritagya'],
        'skybhola': ['Akash', 'Anish'],
        'Propellers': ['Shreyans', 'Akash'],
        'Gaurav/ Palash': ['Gaurav', 'Palash'],
        'SageStark': ['Gaurav', 'Aman'],
        'sagealpha': ['Aman', 'Harshit'],

        // 'Jake/sky' — members[] holds the single string 'Jake/sky', which is a
        // team name rather than two people. Left out until confirmed.
        // 'Coke' / 'Sprite' — seed/test teams, excluded from season records by
        // SeasonDigest. No roster by design.
    };

    /**
     * Alternate spellings → canonical person. Applied after trimming and
     * lowercasing, so only the canonical form needs listing on the right.
     */
    const PLAYER_ALIASES = {
        'k2': 'Kritagya',
        'sky': 'Akash',
    };

    root.ROSTERS = ROSTERS;
    root.PLAYER_ALIASES = PLAYER_ALIASES;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ROSTERS, PLAYER_ALIASES };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
