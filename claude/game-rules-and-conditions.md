# Game Rules and Conditions Documentation

## Overview

This document outlines the comprehensive game rules, validation conditions, and scoring mechanisms implemented in the Card Game Dashboard. The application tracks a card game where teams compete to reach 500 points through multiple rounds of promise-and-actual gameplay.

## Game Structure

### Teams
- **Team Composition**: Each team consists of multiple members (minimum 1, no maximum limit)
- **Team Names**: Must be unique across the system (case-insensitive validation)
- **Team Creation**: Requires administrative authentication

### Matches
- **Format**: Head-to-head between exactly two teams
- **Duration**: Variable, depends on scoring progression
- **Completion**: First team to reach 500 points wins
- **States**: pending → in_progress → completed/cancelled

## Core Game Rules

### Round Structure

Each round consists of two phases:
1. **Promise Phase**: Teams declare how many hands they expect to win
2. **Actual Phase**: Teams record how many hands they actually won

#### Promise Hand Rules
- **Range**: Each team must promise between 4 and 13 hands
- **Validation**: `4 ≤ promiseHands ≤ 13`
- **Purpose**: Strategic declaration of expected performance

#### Actual Hand Rules
- **Constraint**: The sum of both teams' actual hands must equal exactly 13
- **Validation**: `team1Actual + team2Actual = 13`
- **Minimum**: Each team's actual hands must be ≥ 0
- **Logic**: Represents the total hands available in the card game round

### Scoring System

#### Basic Scoring Formula
The scoring system rewards teams for meeting their promised hands and penalizes them for falling short. Three cases apply depending on the relationship between `promiseHands` and `actualHands`, plus a special **Blind** case.

##### Case 1 — Under-promise (Actual < Promise)
If a team fails to meet its promise, the **entire promise** is converted into a negative score (×10). The size of the shortfall does not change the magnitude.

```javascript
teamScore = -(promiseHands * 10)
```

**Examples:**
- Promise 4, Actual 3 → Score = -(4 × 10) = **-40**
- Promise 8, Actual 5 → Score = -(8 × 10) = **-80**
- Promise 10, Actual 0 → Score = -(10 × 10) = **-100**

##### Case 2 — Met promise, with extras (Promise ≤ Actual < Promise × 2)
If a team meets or exceeds its promise but stays **strictly below** double the promise, the promise scores at full value (×10) and each extra hand `a` adds **1 point** (not ×10).

```javascript
const a = actualHands - promiseHands; // a >= 0
// Applies only when actualHands < promiseHands * 2
teamScore = (promiseHands * 10) + a;
```

**Examples:**
- Promise 8, Actual 8 (a = 0) → Score = (8 × 10) + 0 = **80**
- Promise 8, Actual 10 (a = 2) → Score = (8 × 10) + 2 = **82**
- Promise 4, Actual 7 (a = 3) → Score = (4 × 10) + 3 = **43**
- Promise 5, Actual 9 (a = 4) → Score = (5 × 10) + 4 = **54**

> Note: Promise 4, Actual 9 no longer falls here — `9 ≥ 4 × 2` triggers Case 3 (over-extension) below.

##### Case 3 — Over-extension (Actual ≥ Promise × 2)
If a team takes **at least double** its promised hands, the entire promise becomes negative (×10), the same magnitude as an under-promise miss.

```javascript
// Applies when actualHands >= promiseHands * 2
teamScore = -(promiseHands * 10);
```

This rule takes **priority** over Case 2 at and beyond the `2 × Promise` threshold.

**Examples:**
- Promise 4, Actual 8 (8 = 4×2) → Score = -(4 × 10) = **−40**
- Promise 4, Actual 9 → Score = -(4 × 10) = **−40**
- Promise 4, Actual 13 → Score = -(4 × 10) = **−40**
- Promise 5, Actual 10 → Score = -(5 × 10) = **−50**
- Promise 6, Actual 11 → falls under Case 2 → **+65** (11 < 12)

##### Case 4 — Blind bid
If **Blind** is selected for a team, the promise is fixed at **7** and the extra-hand rule does **not** apply.

- **Blind success** (Actual ≥ 7): Score is doubled and fixed.
  ```javascript
  teamScore = 7 * 2 * 10; // = 140
  ```
- **Blind failure** (Actual < 7): Standard under-promise rule applies with promise = 7.
  ```javascript
  teamScore = -(7 * 10); // = -70
  ```

**Examples:**
- Blind, Actual 7 → Score = **+140**
- Blind, Actual 11 → Score = **+140** (extras do not add)
- Blind, Actual 5 → Score = **-70**

#### Score Characteristics
- **Higher is Better**: Meeting the promise within range yields positive points; missing or over-extending yields negative points.
- **Promise Commitment**: Falling short forfeits the entire promise value (negative).
- **Over-Extension Penalty**: Taking ≥ 2× the promised hands also forfeits the entire promise as negative — symmetric with the under-promise penalty.
- **Bonus for Extras**: Hands beyond the promise add 1 point each, but only while `Actual < Promise × 2` (non-Blind only).
- **Blind Bonus**: A successful Blind doubles the standard 7-promise score (140); a failed Blind costs -70 with no extra penalty for the shortfall size. The over-extension rule does not apply to Blind.

#### Case Priority
Evaluate cases in order; the first match wins:
1. Blind selected → Case 4
2. `Actual < Promise` → Case 1 (under-promise)
3. `Actual ≥ Promise × 2` → Case 3 (over-extension)
4. `Promise ≤ Actual < Promise × 2` → Case 2 (met-with-extras)

### Match Progression

#### Round Tracking
- **Current Round**: Starts at 0, increments with each completed round
- **Round History**: Complete record of all rounds with promises, actuals, and scores
- **Running Totals**: Cumulative scores tracked throughout the match

#### Win Conditions
- **Primary Condition**: First team to accumulate 500 or more points wins
- **Immediate Termination**: Match ends as soon as any team reaches 500 points
- **No Draws**: The 500-point threshold ensures a definitive winner

#### Round Statistics
Each team tracks:
- **Rounds Won**: Number of rounds where team scored lower than opponent
- **Rounds Lost**: Number of rounds where team scored higher than opponent
- **Round Scoring**: Individual round performance tracking

## Validation Rules and Constraints

### Input Validation

#### Promise Hand Validation
```javascript
// Implementation reference: js/models/Match.js:52-57, js/services/matchService.js:118-122
if (team1Promise < 4 || team1Promise > 13) {
    throw new Error('Team 1 promise hand must be between 4 and 13');
}
if (team2Promise < 4 || team2Promise > 13) {
    throw new Error('Team 2 promise hand must be between 4 and 13');
}
```

#### Actual Hand Validation
```javascript
// Implementation reference: js/models/Match.js:47-49, js/services/matchService.js:112-114
if (team1Actual + team2Actual !== 13) {
    throw new Error('Actual hands of both teams must equal 13');
}
```

#### Score Boundaries
```javascript
// Implementation reference: js/models/Match.js:59-66, js/services/matchService.js:125-131
const totalScore = team1Score + team2Score;
if (totalScore > 200) {
    throw new Error('Total score cannot be greater than 200');
}
if (totalScore < -100) {
    throw new Error('Total score cannot be less than -100');
}
```

### Business Rule Validations

#### Team Validations
- **Unique Names**: Case-insensitive uniqueness check during team creation
- **Non-empty Names**: Team names cannot be empty or whitespace-only
- **Member Requirements**: At least one member required per team

#### Match Validations
- **Distinct Teams**: Teams cannot play against themselves
- **No Duplicate Pending Matches**: Only one pending match allowed between same teams
- **Status Progression**: Matches must follow proper state transitions

#### Round Validations
- **Match Status**: Rounds can only be added to 'in_progress' matches
- **Sequential Processing**: Rounds must be added in sequence
- **Data Integrity**: All round data must be complete and valid

## Game Mechanics

### Match States and Transitions

#### State Diagram
```
pending → in_progress → completed
   ↓           ↓
cancelled  cancelled
```

#### State Descriptions
- **pending**: Match created but not started
- **in_progress**: Active match accepting rounds
- **completed**: Match finished with winner determined
- **cancelled**: Match terminated before completion

#### Transition Rules
- **pending → in_progress**: Manual start action by authenticated user
- **in_progress → completed**: Automatic when team reaches 500 points
- **Any → cancelled**: Manual cancellation with reason required

### Statistical Calculations

#### Team Statistics
Each team maintains comprehensive statistics:

```javascript
stats: {
    matchesPlayed: number,    // Total matches participated in
    wins: number,             // Matches won (reached 500 first)
    losses: number,           // Matches lost (opponent reached 500 first)
    draws: number,            // Matches tied (currently not possible)
    points: number,           // League points (3 for win, 1 for draw, 0 for loss)
    totalScore: number,       // Cumulative game score across all matches
    roundsWon: number,        // Total rounds won across all matches
    roundsLost: number        // Total rounds lost across all matches
}
```

#### Performance Metrics
- **Win Rate**: `(wins / matchesPlayed) * 100`
- **Average Score**: `totalScore / matchesPlayed`
- **Round Success Rate**: `roundsWon / (roundsWon + roundsLost) * 100`

### Head-to-Head Analysis

#### H2H Statistics
For any two teams, the system tracks:
- Total matches played between them
- Win/loss/draw record for each team
- Average scores in head-to-head encounters
- Recent form in direct matchups

#### Recent Form Tracking
- **Form Window**: Last 5 matches per team
- **Form Indicators**: 'W' (win), 'L' (loss), 'D' (draw)
- **Display Order**: Most recent first

## Advanced Game Features

### Match History and Audit Trail

#### Event Logging
Each match maintains a detailed history of events:
```javascript
history: [
    {
        timestamp: Date,
        action: 'match_created' | 'match_started' | 'round_added' | 'match_completed' | 'match_cancelled',
        details: Object  // Action-specific details
    }
]
```

#### Audit Capabilities
- Complete match reconstruction from history
- User action tracking
- Data integrity verification
- Performance analysis over time

### Tournament Management

#### Ranking System
Teams are ranked by:
1. **Primary**: Total points (3 per win, 1 per draw)
2. **Secondary**: Win rate percentage
3. **Tertiary**: Head-to-head record

#### Activity Tracking
- Recent match results
- Team performance trends
- League activity feed
- Statistical summaries

## Implementation Details

### Data Models

#### Team Model (`js/models/Team.js`)
- Encapsulates team data and statistics
- Provides methods for stat updates and calculations
- Handles match history management

#### Match Model (`js/models/Match.js`)
- Manages match state and progression
- Implements game rule validations
- Tracks round-by-round details

### Service Layer

#### Team Service (`js/services/teamService.js`)
- Team CRUD operations
- Statistics calculations
- Head-to-head analysis

#### Match Service (`js/services/matchService.js`)
- Match lifecycle management
- Round processing and validation
- Automatic statistics updates

### Validation Implementation

#### Client-Side Validation
- Real-time input validation
- User-friendly error messages
- Visual validation feedback

#### Server-Side Validation
- Business rule enforcement
- Data consistency checks
- Security validation

## Error Handling and Edge Cases

### Common Validation Errors
1. **"Team 1 promise hand must be between 4 and 13"**
   - Occurs when promise is outside valid range
   - Solution: Ensure promise values are within 4-13

2. **"Actual hands of both teams must equal 13"**
   - Occurs when actual hands don't sum to 13
   - Solution: Verify actual values sum correctly

3. **"Total score cannot exceed 200 or be less than -100"**
   - Occurs when calculated scores are extreme
   - Solution: Check calculation logic and input values

### Edge Cases Handled
- **Simultaneous 500 Points**: First team processed wins
- **Negative Scores**: Prevented by validation rules
- **Empty Teams**: Prevented by creation validation
- **Duplicate Team Names**: Prevented by uniqueness check

### Data Recovery
- **Statistics Recalculation**: Full statistics rebuild from match history
- **Data Migration**: Automatic local storage to Firebase migration
- **Integrity Validation**: Periodic data consistency checks

## Future Rule Enhancements

### Planned Features
1. **Tournament Brackets**: Structured tournament progression
2. **Handicap System**: Skill-based scoring adjustments
3. **Team Substitutions**: Mid-match player changes
4. **Advanced Scoring**: Multiple scoring algorithms
5. **Seasonal Stats**: Time-based performance tracking

### Rule Variations
1. **Target Score Adjustment**: Configurable win condition (default 500)
2. **Promise Range Modification**: Adjustable promise hand limits
3. **Penalty Multipliers**: Configurable scoring penalties
4. **Round Limits**: Maximum rounds per match
5. **Time-based Rules**: Match duration limits

## Testing and Quality Assurance

### Rule Validation Testing
- Unit tests for each validation rule
- Integration tests for rule combinations  
- Edge case scenario testing
- Performance testing with large datasets

### User Experience Testing
- Validation message clarity
- Error recovery workflows
- Data consistency verification
- Cross-browser compatibility

This comprehensive rule system ensures fair, consistent, and engaging gameplay while maintaining data integrity and providing rich statistical analysis capabilities.