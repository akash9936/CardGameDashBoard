# Setup and Development Guide

## Prerequisites

### System Requirements
- **Node.js**: Version 16 or higher (for development tools)
- **Modern Browser**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Git**: Version control system
- **Text Editor**: VS Code, WebStorm, or similar with JavaScript support

### Firebase Account Setup
1. **Create Firebase Project**:
   - Visit [Firebase Console](https://console.firebase.google.com)
   - Create new project: "card-game-dashboard"
   - Enable Google Analytics (optional)

2. **Enable Firestore Database**:
   - Navigate to "Firestore Database"
   - Create database in production mode
   - Choose location closest to users

3. **Get Project Configuration**:
   - Go to Project Settings → General
   - Scroll to "Your apps" section
   - Copy the Firebase config object

## Local Development Setup

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/card-game-tracker.git
cd card-game-tracker
```

### 2. Environment Configuration

#### Create Environment File
```bash
cp .env.example .env
```

#### Configure `.env` File
```env
# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key_here
FIREBASE_AUTH_DOMAIN=card-game-dashboard.firebaseapp.com
FIREBASE_PROJECT_ID=card-game-dashboard
FIREBASE_STORAGE_BUCKET=card-game-dashboard.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=165351945339
FIREBASE_APP_ID=1:165351945339:web:b1725b0d9272d67369dede

# Application Configuration
AUTH_KEY=your_secure_authentication_key_here
```

**Important Notes**:
- Replace `your_firebase_api_key_here` with actual Firebase API key
- Replace `your_secure_authentication_key_here` with secure custom key
- Never commit `.env` file to version control (already in `.gitignore`)

### 3. Local Server Setup

#### Option 1: Python HTTP Server
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

#### Option 2: Node.js serve
```bash
npx serve -s . -l 8000
```

#### Option 3: Live Server (VS Code Extension)
1. Install "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

### 4. Access Application
- Open browser and navigate to `http://localhost:8000`
- Application should load with Firebase connection test

## Firebase Configuration

### 1. Firestore Database Setup

#### Database Rules Configuration
Update `firestore.rules` for production:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Development: Open access
    match /{document=**} {
      allow read, write: if true;
    }
    
    // Production: Authenticated access (uncomment when ready)
    // match /{document=**} {
    //   allow read, write: if request.auth != null;
    // }
  }
}
```

#### Deploy Rules
```bash
firebase deploy --only firestore:rules
```

### 2. Firebase Authentication (Optional)

#### Enable Authentication
1. Go to Firebase Console → Authentication
2. Click "Sign-in method" tab
3. Enable desired providers (Email/Password, Google, etc.)

#### Update Security Rules
```javascript
// Authenticated users only
match /{document=**} {
  allow read, write: if request.auth != null;
}
```

### 3. Firebase Hosting Setup

#### Install Firebase CLI
```bash
npm install -g firebase-tools
```

#### Initialize Firebase Hosting
```bash
firebase login
firebase init hosting
```

#### Configuration Options
- **Public directory**: `.` (current directory)
- **Single-page app**: Yes
- **Overwrite index.html**: No

#### Deploy to Firebase
```bash
firebase deploy
```

## Development Workflow

### Project Structure
```
card-game-tracker/
├── index.html              # Main entry point
├── css/
│   └── styles.css         # Application styles
├── js/
│   ├── models/            # Data models
│   │   ├── Team.js
│   │   └── Match.js
│   ├── services/          # Business logic layer
│   │   ├── firebaseService.js
│   │   ├── teamService.js
│   │   ├── matchService.js
│   │   └── migrationService.js
│   ├── utils/             # Utility functions
│   │   ├── firebaseConfig.js
│   │   ├── dateUtils.js
│   │   ├── env.js
│   │   └── storage.js
│   └── app.js             # Main application logic
├── firebase.json          # Firebase configuration
├── firestore.rules        # Database security rules
├── .env.example           # Environment template
├── .env                   # Local environment (don't commit)
├── .gitignore             # Git ignore rules
└── README.md              # Project documentation
```

### Code Style Guidelines

#### JavaScript Standards
- **ES6+ Features**: Use modern JavaScript syntax
- **Naming Conventions**: 
  - camelCase for variables and functions
  - PascalCase for classes
  - UPPER_CASE for constants
- **Error Handling**: Always use try-catch for async operations
- **Comments**: JSDoc format for functions and classes

#### Example Code Style
```javascript
/**
 * Creates a new team with validation
 * @param {string} name - Team name
 * @param {Array<string>} members - Array of member names
 * @returns {Promise<string>} Team ID
 * @throws {Error} When validation fails
 */
async function createTeam(name, members) {
  try {
    // Validate input
    if (!name || name.trim() === '') {
      throw new Error('Team name is required');
    }
    
    // Create team
    const teamData = {
      name: name.trim(),
      members,
      createdAt: new Date()
    };
    
    return await firebaseService.createTeam(teamData);
  } catch (error) {
    console.error('Failed to create team:', error);
    throw error;
  }
}
```

### Development Best Practices

#### 1. Environment Management
```javascript
// Always use environment variables for configuration
const firebaseConfig = {
  apiKey: getEnvVar('FIREBASE_API_KEY'),
  projectId: getEnvVar('FIREBASE_PROJECT_ID')
};
```

#### 2. Error Handling
```javascript
// Comprehensive error handling
try {
  await performOperation();
} catch (error) {
  console.error('Operation failed:', error);
  showNotification('Operation failed. Please try again.', 'error');
  throw error; // Re-throw if needed
}
```

#### 3. Data Validation
```javascript
// Client-side validation
function validateRoundData(team1Promise, team1Actual, team2Promise, team2Actual) {
  const errors = [];
  
  if (team1Promise < 4 || team1Promise > 13) {
    errors.push('Team 1 promise must be between 4 and 13');
  }
  
  if (team1Actual + team2Actual !== 13) {
    errors.push('Actual hands must sum to 13');
  }
  
  if (errors.length > 0) {
    throw new Error(errors.join(', '));
  }
}
```

#### 4. Performance Optimization
```javascript
// Efficient DOM updates
function updateTeamsList(teams) {
  const fragment = document.createDocumentFragment();
  
  teams.forEach(team => {
    const element = createTeamElement(team);
    fragment.appendChild(element);
  });
  
  teamsList.replaceChildren(fragment);
}
```

## Testing Strategy

### Manual Testing Checklist

#### Functionality Testing
- [ ] Team creation with validation
- [ ] Match creation between teams
- [ ] Round submission with rule validation
- [ ] Match completion and statistics update
- [ ] Authentication flow
- [ ] Data persistence and retrieval

#### UI/UX Testing
- [ ] Responsive design on mobile/tablet/desktop
- [ ] Modal dialogs and form interactions
- [ ] Navigation between sections
- [ ] Error message display
- [ ] Loading states and feedback

#### Data Integrity Testing
- [ ] Statistics calculation accuracy
- [ ] Match history consistency
- [ ] Data migration from localStorage
- [ ] Real-time updates across sessions

### Automated Testing Setup

#### Unit Testing with Jest
```bash
npm install --save-dev jest
```

#### Example Test
```javascript
// tests/team.test.js
describe('Team Model', () => {
  test('should calculate win rate correctly', () => {
    const team = new Team(1, 'Test Team', ['Player 1']);
    team.stats.matchesPlayed = 10;
    team.stats.wins = 7;
    
    expect(team.getWinRate()).toBe(70);
  });
  
  test('should validate team creation', () => {
    expect(() => new Team(1, '', [])).toThrow('Team name is required');
  });
});
```

## Debugging

### Browser Developer Tools

#### Console Debugging
```javascript
// Debug logging
console.log('Team created:', team);
console.error('Failed to save:', error);
console.warn('Invalid input:', input);

// Performance timing
console.time('Database Operation');
await firebaseService.createTeam(teamData);
console.timeEnd('Database Operation');
```

#### Network Tab
- Monitor Firebase API calls
- Check request/response data
- Identify slow operations

#### Application Tab
- Inspect localStorage data
- Check Firebase connection status
- Monitor real-time listeners

### Common Issues and Solutions

#### Firebase Connection Issues
```javascript
// Test Firebase connection
async function testConnection() {
  try {
    const testRef = firebase.firestore().collection('test').doc('connection');
    await testRef.set({ timestamp: new Date() });
    console.log('✅ Firebase connected');
  } catch (error) {
    console.error('❌ Firebase connection failed:', error);
  }
}
```

#### Environment Variable Problems
```javascript
// Debug environment loading
console.log('Environment variables:', {
  firebaseKey: getEnvVar('FIREBASE_API_KEY') ? 'Loaded' : 'Missing',
  authKey: getEnvVar('AUTH_KEY') ? 'Loaded' : 'Missing'
});
```

#### Real-time Listener Issues
```javascript
// Debug listeners
const unsubscribe = firebaseService.subscribeToTeams((teams) => {
  console.log('Teams updated:', teams.length, 'teams');
});

// Remember to unsubscribe
window.addEventListener('beforeunload', () => {
  unsubscribe();
});
```

## Deployment

### Production Deployment Checklist

#### Pre-deployment
- [ ] Update Firebase security rules
- [ ] Set production environment variables
- [ ] Test authentication with production auth key
- [ ] Verify all features work with production data
- [ ] Run performance testing
- [ ] Check cross-browser compatibility

#### Firebase Hosting Deployment
```bash
# Build and deploy
firebase deploy

# Deploy specific targets
firebase deploy --only hosting
firebase deploy --only firestore:rules
```

#### GitHub Pages Deployment
```bash
# Enable GitHub Pages in repository settings
# Set source to main branch
# Access via https://username.github.io/repository-name
```

### Environment-Specific Configuration

#### Development
```env
FIREBASE_PROJECT_ID=card-game-dashboard-dev
AUTH_KEY=dev_auth_key
```

#### Production
```env
FIREBASE_PROJECT_ID=card-game-dashboard
AUTH_KEY=secure_production_key
```

## Monitoring and Maintenance

### Performance Monitoring
- Firebase Performance Monitoring
- Google Analytics for user behavior
- Browser Performance API for client-side metrics

### Error Tracking
```javascript
// Error logging
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  // Send to error tracking service
});

// Unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});
```

### Database Maintenance
```javascript
// Regular maintenance tasks
async function performMaintenance() {
  // Validate data integrity
  await firebaseService.validateDataIntegrity();
  
  // Clean up old test data
  await cleanupTestData();
  
  // Recalculate statistics
  await matchService.recalculateAllTeamStats();
}
```

## Contributing Guidelines

### Code Contribution Process
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open Pull Request

### Pull Request Guidelines
- Clear description of changes
- Include testing steps
- Update documentation if needed
- Follow existing code style
- Ensure all tests pass

### Issue Reporting
- Use GitHub Issues for bug reports and feature requests
- Include reproduction steps for bugs
- Provide environment details (browser, OS, etc.)
- Search existing issues before creating new ones

This comprehensive setup guide should enable anyone to successfully run and develop the Card Game Dashboard application.