# Database Schema Documentation

## Overview

The Card Game Dashboard uses Firebase Firestore as its primary database. The schema is designed to support real-time multiplayer card game tracking with comprehensive statistics and match history. The database consists of two main collections: `teams` and `matches`, with additional utility collections for testing and migration.

## Database Architecture

### Technology Stack
- **Database**: Firebase Firestore (NoSQL Document Database)
- **Real-time**: Firestore real-time listeners for live updates
- **Security**: Firestore security rules for access control
- **Backup**: Local storage synchronization and migration support

### Connection Configuration
```javascript
// Firebase Configuration (js/utils/firebaseConfig.js)
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: "card-game-dashboard.firebaseapp.com",
    projectId: "card-game-dashboard",
    storageBucket: "card-game-dashboard.firebasestorage.app",
    messagingSenderId: "165351945339",
    appId: "1:165351945339:web:b1725b0d9272d67369dede",
    measurementId: "G-2GJ3CXDKGJ"
};
```

## Collections Schema

### Teams Collection (`/teams/{teamId}`)

The teams collection stores all team information, statistics, and match history.

#### Document Structure
```javascript
{
  // Basic Information
  id: string,                    // Auto-generated document ID
  name: string,                  // Team name (required, unique)
  members: Array<string>,        // Array of team member names
  createdAt: Timestamp,          // Team creation date
  
  // Statistics Object
  stats: {
    matchesPlayed: number,       // Total matches participated in
    wins: number,                // Number of matches won
    losses: number,              // Number of matches lost
    draws: number,               // Number of matches drawn (currently unused)
    points: number,              // League points (3 per win, 1 per draw)
    totalScore: number,          // Cumulative score across all matches
    roundsWon: number,           // Total rounds won across all matches
    roundsLost: number           // Total rounds lost across all matches
  },
  
  // Match History Array
  matchHistory: Array<{
    matchId: string,             // Reference to match document
    opponentId: string,          // Opposing team ID
    result: string,              // 'win' | 'loss' | 'draw'
    date: Timestamp,             // Match date
    score: number,               // Team's final score in match
    rounds: {                    // Round statistics for this match
      won: number,               // Rounds won in this match
      lost: number               // Rounds lost in this match
    }
  }>
}
```

#### Example Team Document
```javascript
{
  id: "ABC123",
  name: "Team Alpha",
  members: ["John Doe", "Jane Smith", "Bob Wilson"],
  createdAt: Timestamp("2024-01-15T10:30:00Z"),
  stats: {
    matchesPlayed: 12,
    wins: 8,
    losses: 4,
    draws: 0,
    points: 24,
    totalScore: 4250,
    roundsWon: 89,
    roundsLost: 67
  },
  matchHistory: [
    {
      matchId: "MATCH001",
      opponentId: "DEF456",
      result: "win",
      date: Timestamp("2024-01-20T14:45:00Z"),
      score: 520,
      rounds: { won: 8, lost: 5 }
    }
  ]
}
```

#### Indexes
- **Primary**: Document ID (auto-indexed)
- **Secondary**: `name` field for uniqueness validation
- **Composite**: `stats.points` (descending) for rankings
- **Array**: `members` field for member-based queries

### Matches Collection (`/matches/{matchId}`)

The matches collection stores detailed information about individual matches, including round-by-round data and match progression.

#### Document Structure
```javascript
{
  // Basic Match Information
  id: string,                    // Auto-generated document ID
  team1Id: string,               // First team's document ID
  team2Id: string,               // Second team's document ID
  date: Timestamp,               // Match creation/start date
  
  // Match State
  status: string,                // 'pending' | 'in_progress' | 'completed' | 'cancelled'
  currentRound: number,          // Current round number (0-based)
  winnerId: string | null,       // Winning team ID (null if not completed)
  
  // Scoring Information
  finalScore: {
    team1: number,               // Team 1's cumulative score
    team2: number                // Team 2's cumulative score
  },
  
  // Round Statistics
  roundStats: {
    team1: {
      won: number,               // Rounds won by team 1
      lost: number               // Rounds lost by team 1
    },
    team2: {
      won: number,               // Rounds won by team 2
      lost: number               // Rounds lost by team 2
    }
  },
  
  // Detailed Round Data
  rounds: Array<{
    roundNumber: number,         // Sequential round number
    team1: {
      promise: number,           // Team 1's promised hands (4-13)
      actual: number,            // Team 1's actual hands (≥0)
      score: number              // Team 1's score for this round
    },
    team2: {
      promise: number,           // Team 2's promised hands (4-13)
      actual: number,            // Team 2's actual hands (≥0)
      score: number              // Team 2's score for this round
    }
  }>,
  
  // Match History/Audit Trail
  history: Array<{
    timestamp: Timestamp,        // Event timestamp
    action: string,              // Event type
    details: Object              // Action-specific details
  }>
}
```

#### Example Match Document
```javascript
{
  id: "MATCH001",
  team1Id: "ABC123",
  team2Id: "DEF456",
  date: Timestamp("2024-01-20T14:00:00Z"),
  status: "completed",
  currentRound: 15,
  winnerId: "ABC123",
  finalScore: {
    team1: 520,
    team2: 480
  },
  roundStats: {
    team1: { won: 8, lost: 7 },
    team2: { won: 7, lost: 8 }
  },
  rounds: [
    {
      roundNumber: 1,
      team1: { promise: 6, actual: 6, score: 0 },
      team2: { promise: 7, actual: 7, score: 0 }
    },
    {
      roundNumber: 2,
      team1: { promise: 8, actual: 5, score: 30 },
      team2: { promise: 5, actual: 8, score: 30 }
    }
  ],
  history: [
    {
      timestamp: Timestamp("2024-01-20T14:00:00Z"),
      action: "match_created",
      details: { team1Id: "ABC123", team2Id: "DEF456" }
    },
    {
      timestamp: Timestamp("2024-01-20T14:05:00Z"),
      action: "match_started",
      details: {}
    },
    {
      timestamp: Timestamp("2024-01-20T14:10:00Z"),
      action: "round_added",
      details: {
        roundNumber: 1,
        team1: { promise: 6, actual: 6, score: 0 },
        team2: { promise: 7, actual: 7, score: 0 }
      }
    },
    {
      timestamp: Timestamp("2024-01-20T16:30:00Z"),
      action: "match_completed",
      details: {
        finalScore: { team1: 520, team2: 480 },
        winnerId: "ABC123"
      }
    }
  ]
}
```

#### Indexes
- **Primary**: Document ID (auto-indexed)
- **Secondary**: `team1Id`, `team2Id` for team-based queries
- **Composite**: `date` (descending) for chronological ordering
- **Status**: `status` field for filtering active/completed matches

## Utility Collections

### Test Collection (`/test/{documentId}`)
Used for Firebase connection testing and health checks.

```javascript
{
  connection: "test",
  timestamp: Timestamp,
  status: "ok"
}
```

### Legacy Collection (`/cardGame/{documentId}`)
Maintained for backward compatibility during migration phases.

## Data Relationships

### Team ↔ Match Relationship
- **Type**: Many-to-Many (teams can have multiple matches, matches involve exactly 2 teams)
- **Implementation**: Foreign key references (`team1Id`, `team2Id` in matches)
- **Integrity**: Referential integrity maintained at application level

### Match → Rounds Relationship
- **Type**: One-to-Many (embedded array)
- **Implementation**: `rounds` array within match document
- **Benefits**: Atomic operations, consistent round data

### Team → Match History Relationship
- **Type**: Embedded denormalized data
- **Implementation**: `matchHistory` array within team document
- **Purpose**: Fast access to team's match performance without joins

## Data Validation Rules

### Firestore Security Rules (`firestore.rules`)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Teams Collection
    match /teams/{document=**} {
      allow read, write: if true; // Development mode - open access
      // Production: allow read, write: if request.auth != null;
    }
    
    // Matches Collection
    match /matches/{document=**} {
      allow read, write: if true; // Development mode - open access
      // Production: allow read, write: if request.auth != null;
    }
    
    // Test Collection
    match /test/{document=**} {
      allow read, write: if true;
    }
  }
}
```

### Application-Level Validation

#### Team Validation
```javascript
// Team creation validation
function validateTeamData(teamData) {
  if (!teamData.name || teamData.name.trim() === '') {
    throw new Error('Team name is required');
  }
  
  if (!Array.isArray(teamData.members) || teamData.members.length === 0) {
    throw new Error('At least one team member is required');
  }
}
```

#### Match Validation
```javascript
// Round data validation
function validateRoundData(team1Promise, team1Actual, team2Promise, team2Actual) {
  if (team1Promise < 4 || team1Promise > 13 || team2Promise < 4 || team2Promise > 13) {
    throw new Error('Promise hands must be between 4 and 13');
  }
  
  if (team1Actual + team2Actual !== 13) {
    throw new Error('Actual hands must sum to 13');
  }
}
```

## Performance Optimization

### Query Optimization
- **Limit Results**: Use `.limit()` for pagination
- **Index Usage**: Leverage composite indexes for complex queries
- **Real-time Listeners**: Minimize active listeners to reduce costs

### Data Structure Optimization
- **Denormalization**: Strategic data duplication for read performance
- **Embedded Arrays**: Reduce document reads for related data
- **Batch Operations**: Atomic multi-document updates

### Caching Strategy
- **Local Storage**: Cache frequently accessed data
- **Memory Cache**: In-memory caching for session data
- **TTL**: Time-based cache invalidation

## Migration and Backup

### Local Storage Migration
The application supports migration from localStorage to Firestore:

```javascript
// Migration process
async function migrateData() {
  const localData = exportFromLocalStorage();
  await uploadToFirestore(localData);
  await validateMigration();
}
```

### Data Export/Import
- **JSON Export**: Complete database export capability
- **Incremental Backup**: Regular data synchronization
- **Recovery**: Point-in-time data restoration

## Monitoring and Analytics

### Performance Metrics
- **Read Operations**: Track document reads per collection
- **Write Operations**: Monitor write frequency and patterns
- **Real-time Connections**: Active listener count
- **Error Rates**: Failed operation tracking

### Usage Analytics
- **Popular Queries**: Most frequently executed queries
- **Data Growth**: Collection size trends over time
- **User Patterns**: Peak usage times and features

## Scaling Considerations

### Horizontal Scaling
- **Collection Sharding**: Partition large collections by date/region
- **Read Replicas**: Geographic distribution for read performance
- **Caching Layer**: Redis/Memcached for frequently accessed data

### Vertical Scaling
- **Index Optimization**: Regular index analysis and optimization
- **Query Optimization**: Efficient query patterns and structures
- **Data Archiving**: Move old data to cold storage

## Security Implementation

### Authentication Integration
- **Firebase Auth**: User authentication and authorization
- **Custom Claims**: Role-based access control
- **Session Management**: Secure session handling

### Data Protection
- **Field-Level Security**: Sensitive data encryption
- **Audit Logging**: Complete audit trail for all operations
- **Access Control**: Granular permissions system

## Future Enhancements

### Schema Evolution
- **Version Management**: Database schema versioning
- **Migration Scripts**: Automated schema updates
- **Backward Compatibility**: Support for legacy data formats

### Advanced Features
- **Full-Text Search**: Algolia or Elasticsearch integration
- **Real-time Analytics**: Advanced statistics and reporting
- **Multi-tenancy**: Support for multiple tournaments/leagues
- **GraphQL API**: Unified data access layer

This database schema provides a robust foundation for the card game application while maintaining flexibility for future enhancements and scaling requirements.