# API Documentation - Services and Methods

## Firebase Service API (`js/services/firebaseService.js`)

The FirebaseService class provides a comprehensive abstraction layer for all Firebase Firestore operations.

### Constructor
```javascript
new FirebaseService()
```
- Initializes Firestore database connection
- Sets up error handling and logging

### Team Operations

#### `createTeam(teamData)`
Creates a new team in Firestore.

**Parameters:**
- `teamData` (Object): Team data structure
  - `name` (string): Team name
  - `members` (Array<string>): Array of member names
  - `createdAt` (Date): Creation timestamp
  - `stats` (Object): Initial statistics object
  - `matchHistory` (Array): Initial match history

**Returns:** Promise<string> - Document ID of created team

**Example:**
```javascript
const teamData = {
  name: "Team Alpha",
  members: ["John Doe", "Jane Smith"],
  createdAt: new Date(),
  stats: { matchesPlayed: 0, wins: 0, losses: 0, draws: 0, points: 0 },
  matchHistory: []
};
const teamId = await firebaseService.createTeam(teamData);
```

#### `updateTeam(teamId, updates)`
Updates an existing team.

**Parameters:**
- `teamId` (string): Team document ID
- `updates` (Object): Fields to update

**Returns:** Promise<void>

**Example:**
```javascript
await firebaseService.updateTeam(teamId, {
  'stats.wins': 5,
  'stats.points': 15
});
```

#### `getTeam(teamId)`
Retrieves a single team by ID.

**Parameters:**
- `teamId` (string): Team document ID

**Returns:** Promise<Object|null> - Team data with ID, or null if not found

#### `getAllTeams()`
Retrieves all teams.

**Returns:** Promise<Array<Object>> - Array of team objects with IDs

### Match Operations

#### `createMatch(matchData)`
Creates a new match in Firestore.

**Parameters:**
- `matchData` (Object): Match data structure
  - `team1Id` (string): First team ID
  - `team2Id` (string): Second team ID
  - `date` (Date): Match date
  - `status` (string): Match status ('pending', 'in_progress', 'completed', 'cancelled')
  - `currentRound` (number): Current round number
  - `rounds` (Array): Array of round data
  - `finalScore` (Object): Final scores { team1: number, team2: number }
  - `winnerId` (string|null): Winner team ID
  - `history` (Array): Match history events

**Returns:** Promise<string> - Document ID of created match

#### `updateMatch(matchId, updates)`
Updates an existing match.

**Parameters:**
- `matchId` (string): Match document ID
- `updates` (Object): Fields to update

**Returns:** Promise<void>

#### `getMatch(matchId)`
Retrieves a single match by ID.

**Parameters:**
- `matchId` (string): Match document ID

**Returns:** Promise<Object|null> - Match data with ID, or null if not found

#### `getAllMatches()`
Retrieves all matches.

**Returns:** Promise<Array<Object>> - Array of match objects with IDs

### Real-time Subscriptions

#### `subscribeToTeams(callback)`
Sets up real-time listener for teams collection.

**Parameters:**
- `callback` (Function): Callback function that receives updated teams array

**Returns:** Function - Unsubscribe function

**Example:**
```javascript
const unsubscribe = firebaseService.subscribeToTeams((teams) => {
  console.log('Teams updated:', teams);
  updateUI(teams);
});

// Later, to stop listening:
unsubscribe();
```

#### `subscribeToMatches(callback)`
Sets up real-time listener for matches collection.

**Parameters:**
- `callback` (Function): Callback function that receives updated matches array

**Returns:** Function - Unsubscribe function

### Migration and Utilities

#### `migrateFromLocalStorage(data)`
Migrates data from local storage to Firestore using batch operations.

**Parameters:**
- `data` (Object): Data to migrate
  - `teams` (Array): Array of team objects
  - `matches` (Array): Array of match objects

**Returns:** Promise<void>

#### `validateDataIntegrity()`
Validates data integrity and returns counts.

**Returns:** Promise<Object> - Object with teams and matches counts

## Team Service API (`js/services/teamService.js`)

The TeamService class provides high-level team management operations.

### Constructor
```javascript
new TeamService(firebaseService)
```

**Parameters:**
- `firebaseService` (FirebaseService): Firebase service instance

### Methods

#### `createTeam(name, members)`
Creates a new team with validation.

**Parameters:**
- `name` (string): Team name (required, must be unique)
- `members` (Array<string>): Array of team member names

**Returns:** Promise<string> - Team ID

**Validation:**
- Name cannot be empty
- Name must be unique (case-insensitive)

**Errors:**
- 'Team name is required'
- 'A team with this name already exists'

#### `getTeamDetails(teamId)`
Retrieves detailed team information including recent matches and form.

**Parameters:**
- `teamId` (string): Team ID

**Returns:** Promise<Object> - Enhanced team object with:
- All team properties
- `recentMatches` (Array): Last 5 matches with results
- `recentForm` (Array): Form indicators ['win', 'loss', 'draw']

#### `getHeadToHead(team1Id, team2Id)`
Calculates head-to-head statistics between two teams.

**Parameters:**
- `team1Id` (string): First team ID
- `team2Id` (string): Second team ID

**Returns:** Promise<Object> - Head-to-head statistics:
```javascript
{
  team1: { wins: number, losses: number, draws: number },
  team2: { wins: number, losses: number, draws: number },
  totalMatches: number
}
```

#### `getAllTeams()`
Retrieves all teams.

**Returns:** Promise<Array<Object>> - Array of team objects

#### `getTeamRankings()`
Retrieves teams sorted by points (rankings).

**Returns:** Promise<Array<Object>> - Array of teams sorted by points (descending)

## Match Service API (`js/services/matchService.js`)

The MatchService class provides comprehensive match management operations.

### Constructor
```javascript
new MatchService(firebaseService)
```

### Match Creation and Management

#### `createMatch(team1Id, team2Id)`
Creates a new match between two teams.

**Parameters:**
- `team1Id` (string): First team ID
- `team2Id` (string): Second team ID

**Returns:** Promise<Object> - Object with match `id`

**Validation:**
- Both teams must exist
- Teams cannot be the same
- No existing pending match between the same teams

**Errors:**
- 'One or both teams not found'
- 'A team cannot play against itself'
- 'There is already a pending match between these teams'

#### `getMatchDetails(matchId)`
Retrieves detailed match information including team data.

**Parameters:**
- `matchId` (string): Match ID

**Returns:** Promise<Object> - Enhanced match object with `teams` property containing team1 and team2 data

#### `getAllMatches(filters)`
Retrieves matches with optional filtering.

**Parameters:**
- `filters` (Object, optional): Filter options
  - `status` (string): Filter by match status
  - `teamId` (string): Filter matches involving specific team

**Returns:** Promise<Array<Object>> - Array of matches sorted by date (most recent first)

#### `getRecentMatches(limit)`
Retrieves recent matches.

**Parameters:**
- `limit` (number, default: 10): Maximum number of matches to return

**Returns:** Promise<Array<Object>> - Array of recent matches

### Match Progression

#### `startMatch(matchId)`
Starts a pending match (changes status to 'in_progress').

**Parameters:**
- `matchId` (string): Match ID

**Returns:** Promise<void>

#### `addRound(matchId, team1Promise, team1Actual, team2Promise, team2Actual, team1Score, team2Score)`
Adds a round to an in-progress match.

**Parameters:**
- `matchId` (string): Match ID
- `team1Promise` (number): Team 1 promised hands (4-13)
- `team1Actual` (number): Team 1 actual hands (≥0)
- `team2Promise` (number): Team 2 promised hands (4-13)
- `team2Actual` (number): Team 2 actual hands (≥0)
- `team1Score` (number): Team 1 round score
- `team2Score` (number): Team 2 round score

**Returns:** Promise<void>

**Validation Rules:**
- Match must be 'in_progress'
- Promise hands must be between 4 and 13
- Actual hands cannot be negative
- Team 1 + Team 2 actual hands must equal 13
- Total score cannot exceed 200 or be less than -100

**Auto-completion:**
- Match automatically completes when either team reaches 500 points
- Team statistics are automatically updated upon completion

#### `cancelMatch(matchId, reason)`
Cancels a match with a reason.

**Parameters:**
- `matchId` (string): Match ID
- `reason` (string): Cancellation reason

**Returns:** Promise<void>

### Statistics Management

#### `updateTeamStats(team1Id, team2Id, matchUpdates)`
Updates team statistics after match completion.

**Parameters:**
- `team1Id` (string): First team ID
- `team2Id` (string): Second team ID
- `matchUpdates` (Object): Match data with final scores and statistics

**Returns:** Promise<void>

**Updates Include:**
- Matches played count
- Wins/losses/draws counts
- Points (3 for win, 1 for draw, 0 for loss)
- Total score accumulation
- Rounds won/lost statistics
- Match history entries

#### `recalculateAllTeamStats()`
Recalculates all team statistics from existing completed matches.

**Process:**
1. Resets all team statistics to zero
2. Processes all completed matches chronologically
3. Updates team statistics for each match

**Returns:** Promise<void>

**Use Cases:**
- Data corruption recovery
- Statistics synchronization
- Database maintenance

## Environment Configuration API (`js/utils/env.js`)

### Functions

#### `getEnvVar(key, fallback)`
Retrieves environment variable with fallback support.

**Parameters:**
- `key` (string): Environment variable key
- `fallback` (any, default: null): Fallback value if variable not found

**Returns:** string|any - Environment variable value or fallback

**Sources (in order of priority):**
1. `.env` file variables (loaded via `window.env`)
2. `process.env` variables (Node.js environments)
3. Fallback value

## Error Handling

All service methods implement comprehensive error handling:

### Common Error Patterns
- **Validation Errors**: Input validation failures with descriptive messages
- **Not Found Errors**: Resource not found scenarios
- **Constraint Errors**: Business rule violations
- **Network Errors**: Firebase connection and operation failures

### Error Response Format
```javascript
try {
  await serviceMethod();
} catch (error) {
  // error.message contains user-friendly error description
  console.error('Operation failed:', error.message);
}
```

## Authentication Integration

All administrative operations require authentication:

### Authentication Flow
1. Check authentication status via `storage.isAuthenticated()`
2. If not authenticated, prompt for authentication key
3. Validate key against configured `AUTH_KEY`
4. Store authentication state for session

### Protected Operations
- Creating teams
- Creating matches
- Starting matches
- Adding rounds
- Canceling matches
- Recalculating statistics

## Real-time Data Flow

The application uses Firebase real-time listeners for live updates:

### Subscription Pattern
```javascript
// Set up listener
const unsubscribe = firebaseService.subscribeToTeams((teams) => {
  // Update UI with new data
  refreshTeamsList(teams);
});

// Clean up listener when component unmounts
unsubscribe();
```

### Data Synchronization
- Automatic UI updates when data changes
- Minimal re-rendering strategies
- Conflict resolution for concurrent updates
- Offline/online state management

## Performance Considerations

### Optimization Strategies
- **Lazy Loading**: Detailed data loaded only when needed
- **Caching**: Local storage for frequently accessed data
- **Batch Operations**: Multiple updates in single transaction
- **Indexed Queries**: Efficient data retrieval patterns

### Best Practices
- Use real-time listeners judiciously
- Implement proper error boundaries
- Handle network connectivity issues
- Optimize for mobile performance