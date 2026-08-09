# Architecture Overview

## System Architecture

The Card Game Dashboard follows a modern client-side architecture with Firebase as the backend service. The application implements a modular, service-oriented design pattern with clear separation of concerns.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client Layer                           │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (Vanilla JavaScript, HTML5, CSS3)                    │
│  ├── UI Components (app.js)                                    │
│  ├── Models (Team.js, Match.js)                               │
│  ├── Services (teamService.js, matchService.js)               │
│  └── Utils (dateUtils.js, storage.js, env.js)                │
├─────────────────────────────────────────────────────────────────┤
│                      Abstraction Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  Firebase Service Layer                                        │
│  ├── FirebaseService.js (CRUD operations)                     │
│  ├── MigrationService.js (Data migration)                     │
│  └── Real-time Listeners                                      │
├─────────────────────────────────────────────────────────────────┤
│                        Backend Layer                           │
├─────────────────────────────────────────────────────────────────┤
│  Firebase Platform                                             │
│  ├── Firestore Database (NoSQL document store)               │
│  ├── Firebase Authentication (User management)               │
│  ├── Firebase Hosting (Static site hosting)                 │
│  └── Firebase Security Rules (Access control)               │
└─────────────────────────────────────────────────────────────────┘
```

## Design Patterns

### Model-View-Controller (MVC)

#### Models (`js/models/`)
- **Team.js**: Team entity with business logic, statistics calculations, and data persistence methods
- **Match.js**: Match entity with game rules, round management, and state transitions

#### Views (HTML + CSS + DOM Manipulation)
- **index.html**: Semantic HTML structure with accessibility features
- **css/styles.css**: Responsive design with CSS Grid and Flexbox
- **app.js**: Dynamic DOM manipulation and UI state management

#### Controllers (Service Layer)
- **teamService.js**: Team business operations and validation
- **matchService.js**: Match lifecycle management and scoring
- **firebaseService.js**: Data persistence abstraction

### Service Layer Pattern

```javascript
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   TeamService   │    │  MatchService   │    │ FirebaseService │
│                 │    │                 │    │                 │
│ - createTeam()  │    │ - createMatch() │    │ - createTeam()  │
│ - getTeam()     │◄──►│ - addRound()    │◄──►│ - updateMatch() │
│ - getRankings() │    │ - startMatch()  │    │ - getAllTeams() │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Repository Pattern
The Firebase service acts as a repository, providing a consistent interface for data operations regardless of the underlying storage mechanism.

### Observer Pattern
Real-time updates are implemented using Firebase listeners that notify UI components when data changes.

## Component Architecture

### Core Components

#### Application Controller (`js/app.js`)
```javascript
// Main application orchestrator
class Application {
  constructor() {
    this.initializeServices();
    this.setupEventListeners();
    this.initializeUI();
  }
  
  // UI state management
  showSection(section);
  showModal(content);
  refreshData();
}
```

#### Data Models

##### Team Model (`js/models/Team.js`)
```javascript
class Team {
  constructor(id, name, members, createdAt);
  
  // Business logic methods
  updateStats(match);
  getWinRate();
  getRecentForm();
  getPerformanceAgainst(opponentId);
  
  // Serialization methods
  toJSON();
  static fromJSON(json);
}
```

##### Match Model (`js/models/Match.js`)
```javascript
class Match {
  constructor(id, team1Id, team2Id, date);
  
  // Game rule methods
  addRound(team1Promise, team1Actual, team2Promise, team2Actual);
  start();
  complete();
  cancel(reason);
  
  // State management
  getResultForTeam(teamId);
  getSummary();
  
  // Serialization methods
  toJSON();
  static fromJSON(json);
}
```

#### Service Layer

##### Firebase Service (`js/services/firebaseService.js`)
```javascript
class FirebaseService {
  constructor();
  
  // CRUD operations
  createTeam(teamData);
  updateTeam(teamId, updates);
  getTeam(teamId);
  getAllTeams();
  
  // Real-time subscriptions
  subscribeToTeams(callback);
  subscribeToMatches(callback);
  
  // Migration utilities
  migrateFromLocalStorage(data);
  validateDataIntegrity();
}
```

## Data Flow Architecture

### Unidirectional Data Flow

```
User Action → Service Layer → Firebase → Real-time Listener → UI Update
     ↑                                                            ↓
     └────────────── UI Event Handlers ←──────────────────────────┘
```

### Detailed Flow Example: Adding a Round

1. **User Input**: User submits round form
2. **Validation**: Client-side validation in UI layer
3. **Authentication**: Check user authentication status
4. **Service Call**: `matchService.addRound()` called
5. **Business Logic**: Match model validates and processes round
6. **Persistence**: Firebase service updates match document
7. **Real-time Update**: Firestore triggers real-time listener
8. **UI Refresh**: UI components update automatically

## State Management

### Application State
The application maintains state across multiple layers:

#### Client-Side State
- **UI State**: Active section, modal visibility, form data
- **Authentication State**: User login status, session management
- **Cache State**: Local storage for offline support

#### Server State (Firebase)
- **Persistent Data**: Teams, matches, and historical data
- **Real-time State**: Live updates via WebSocket connections

### State Synchronization

```javascript
// Real-time state synchronization
firebaseService.subscribeToTeams((teams) => {
  // Update local state
  application.updateTeamsData(teams);
  
  // Refresh UI components
  application.refreshTeamsList();
});
```

## Security Architecture

### Authentication Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │    Client   │    │   Firebase  │
│             │    │             │    │             │
│ Enter Key   │───►│ Validate    │───►│ Store State │
│             │    │ Auth Key    │    │             │
│             │◄───│ Set Session │◄───│ Return      │
└─────────────┘    └─────────────┘    └─────────────┘
```

### Security Layers

1. **Client-Side Validation**: Input sanitization and business rule validation
2. **Authentication Gates**: Key-based authentication for administrative actions
3. **Firebase Rules**: Database-level access control (currently open for development)
4. **Environment Security**: Secure configuration management

## Performance Architecture

### Optimization Strategies

#### Client-Side Optimization
- **Lazy Loading**: Load detailed data only when needed
- **Efficient DOM Updates**: Minimal re-rendering strategies
- **Local Caching**: Store frequently accessed data in localStorage
- **Batch Operations**: Group multiple updates together

#### Database Optimization
- **Indexed Queries**: Optimal query performance with proper indexing
- **Denormalized Data**: Strategic data duplication for read performance
- **Real-time Efficiency**: Selective listeners to minimize bandwidth

### Performance Monitoring

```javascript
// Performance tracking example
class PerformanceMonitor {
  trackOperation(operation, startTime, endTime) {
    console.log(`${operation}: ${endTime - startTime}ms`);
  }
  
  trackFirebaseOperation(collection, operation) {
    // Monitor Firebase operation performance
  }
}
```

## Scalability Architecture

### Horizontal Scaling Considerations

#### Client-Side Scaling
- **Code Splitting**: Modular loading for large applications
- **CDN Delivery**: Static asset distribution
- **Service Workers**: Offline support and caching

#### Database Scaling
- **Collection Partitioning**: Shard large datasets
- **Read Replicas**: Geographic distribution
- **Caching Layers**: Redis/Memcached integration

### Vertical Scaling
- **Query Optimization**: Efficient data access patterns
- **Index Optimization**: Strategic index management
- **Connection Pooling**: Optimize Firebase connections

## Error Handling Architecture

### Error Boundaries

```javascript
// Service-level error handling
class TeamService {
  async createTeam(name, members) {
    try {
      await this.firebaseService.createTeam(teamData);
    } catch (error) {
      console.error('Team creation failed:', error);
      throw new UserFriendlyError('Failed to create team. Please try again.');
    }
  }
}
```

### Error Propagation
1. **Model Layer**: Data validation errors
2. **Service Layer**: Business logic and database errors
3. **UI Layer**: User-friendly error messages and recovery options

## Testing Architecture

### Testing Strategy

#### Unit Testing
- **Models**: Test business logic and data transformations
- **Services**: Test CRUD operations and business rules
- **Utilities**: Test helper functions and calculations

#### Integration Testing
- **Firebase Integration**: Test database operations
- **Real-time Features**: Test listener functionality
- **Authentication Flow**: Test security mechanisms

#### End-to-End Testing
- **User Workflows**: Complete user journeys
- **Cross-browser Testing**: Compatibility verification
- **Performance Testing**: Load and stress testing

## Development Architecture

### Build Process
```
Source Code → Linting → Testing → Bundling → Deployment
     ↓           ↓         ↓         ↓          ↓
   ES6+      ESLint    Jest     (None)   Firebase/GitHub
```

### Development Workflow
1. **Local Development**: Environment variable configuration
2. **Version Control**: Git-based workflow with feature branches
3. **Continuous Integration**: Automated testing and deployment
4. **Environment Management**: Separate dev/staging/production environments

## Deployment Architecture

### Multi-Environment Setup

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Development   │    │     Staging     │    │   Production    │
│                 │    │                 │    │                 │
│ Local Firebase  │───►│ Test Firebase   │───►│ Prod Firebase   │
│ .env.local      │    │ GitHub Secrets  │    │ GitHub Secrets  │
│ Hot Reload      │    │ Preview Deploy  │    │ Stable Release  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Deployment Strategies
- **Firebase Hosting**: Primary deployment platform
- **GitHub Pages**: Backup deployment option
- **Environment Variables**: Secure configuration management
- **Rollback Support**: Quick reversion capabilities

## Monitoring and Observability

### Application Monitoring
- **Error Tracking**: Comprehensive error logging
- **Performance Metrics**: Response time and throughput monitoring
- **User Analytics**: Usage patterns and feature adoption
- **Firebase Monitoring**: Database performance and costs

### Logging Strategy
```javascript
class Logger {
  info(message, data) {
    console.log(`[INFO] ${message}`, data);
  }
  
  error(message, error) {
    console.error(`[ERROR] ${message}`, error);
    // Send to monitoring service
  }
  
  performance(operation, duration) {
    console.log(`[PERF] ${operation}: ${duration}ms`);
  }
}
```

This architecture provides a solid foundation for the current application while supporting future growth and enhancement requirements. The modular design ensures maintainability, while the service-oriented approach enables easy testing and scaling.