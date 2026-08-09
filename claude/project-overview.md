# Card Game Dashboard - Project Overview

## Project Description
A comprehensive web-based card game score tracking application built with vanilla JavaScript and Firebase. The application manages teams, matches, rounds, and provides detailed statistics for card game tournaments.

## Technology Stack

### Frontend
- **HTML5** - Semantic markup structure
- **CSS3** - Styling with custom properties and responsive design
- **Vanilla JavaScript** - No external JS frameworks, ES6+ features
- **Spline 3D** - Interactive 3D background animations

### Backend & Database
- **Firebase Firestore** - NoSQL document database
- **Firebase Authentication** - User authentication (configured but not actively used)
- **Firebase Hosting** - Web application hosting

### Development & Deployment
- **Environment Variables** - Configuration management via .env files
- **GitHub Actions** - CI/CD pipeline for automated deployment
- **GitHub Pages** - Static site hosting (alternative to Firebase hosting)

## Project Structure

```
CardGame/
├── index.html                 # Main application entry point
├── css/
│   └── styles.css            # Application styling
├── js/
│   ├── models/
│   │   ├── Team.js           # Team data model and business logic
│   │   └── Match.js          # Match data model and game rules
│   ├── services/
│   │   ├── firebaseService.js    # Firebase CRUD operations
│   │   ├── teamService.js        # Team management service
│   │   ├── matchService.js       # Match management service
│   │   └── migrationService.js   # Data migration utilities
│   ├── utils/
│   │   ├── firebaseConfig.js     # Firebase configuration
│   │   ├── dateUtils.js          # Date handling utilities
│   │   ├── env.js                # Environment variable loader
│   │   └── storage.js            # Local storage management
│   └── app.js                # Main application controller
├── firebase.json             # Firebase project configuration
├── firestore.rules           # Firestore security rules
├── database.rules.json       # Realtime database rules
├── .env.example              # Environment variables template
└── README.md                 # Project documentation
```

## Key Features

### Team Management
- Create teams with multiple members
- Team statistics tracking (wins, losses, draws, points)
- Team rankings and performance metrics
- Head-to-head statistics between teams

### Match Management
- Create matches between teams
- Real-time match progression
- Round-by-round score tracking
- Match history and detailed statistics

### Game Rules Implementation
- Promise vs Actual hand validation
- Scoring system based on card game rules
- Match completion conditions (first to 500 points)
- Round statistics tracking

### Authentication System
- Key-based authentication for administrative actions
- Configurable authentication key via environment variables
- Session-based authentication state management

### Data Management
- Firebase Firestore integration for persistent storage
- Local storage fallback and migration
- Real-time data synchronization
- Export/import functionality

## Architecture Patterns

### Model-View-Controller (MVC)
- **Models**: `Team.js`, `Match.js` - Data structures and business logic
- **Views**: HTML templates in `app.js` - UI rendering
- **Controllers**: Services layer - Data manipulation and API calls

### Service Layer Pattern
- **FirebaseService**: Database operations abstraction
- **TeamService**: Team-specific business operations
- **MatchService**: Match-specific business operations

### Repository Pattern
- Centralized data access through service classes
- Consistent CRUD operations across different data types
- Error handling and validation at service level

## Environment Configuration

### Required Environment Variables
- `FIREBASE_API_KEY`: Firebase project API key
- `AUTH_KEY`: Administrative authentication key

### Configuration Files
- `.env`: Local development configuration
- `firebase.json`: Firebase project settings
- `firestore.rules`: Database security rules

## Security Considerations

### Authentication
- Key-based authentication for sensitive operations
- Session state management
- Environment-based key configuration

### Database Security
- Firestore rules configured for development (open access)
- Ready for authentication-based security rules
- Separate collections for teams and matches

### Data Validation
- Client-side validation for all user inputs
- Business rule validation in model classes
- Error handling and user feedback

## Performance Optimizations

### Real-time Updates
- Firebase real-time listeners for live data updates
- Efficient DOM updates based on data changes
- Minimal re-rendering strategies

### Data Management
- Lazy loading of detailed statistics
- Efficient data structures for complex queries
- Local storage caching for offline functionality

## Deployment Strategy

### Development
- Local development with `.env` file configuration
- Local Firebase emulator support ready
- Hot reload and development server setup

### Production
- GitHub Actions automated deployment
- Environment variables via GitHub Secrets
- Multi-platform deployment (Firebase Hosting + GitHub Pages)

## Future Enhancements

### Planned Features
- User authentication integration
- Real-time multiplayer support
- Advanced statistics and analytics
- Mobile responsive improvements
- Tournament bracket management

### Technical Improvements
- TypeScript migration
- Modern bundling (Webpack/Vite)
- Progressive Web App (PWA) features
- Offline-first architecture
- Comprehensive testing suite

## Development Guidelines

### Code Standards
- ES6+ JavaScript features
- Consistent naming conventions
- Comprehensive error handling
- Detailed logging for debugging

### File Organization
- Modular architecture with clear separation of concerns
- Consistent file naming patterns
- Logical directory structure
- Clear dependency management

### Documentation
- Comprehensive inline code comments
- API documentation for services
- Setup and deployment guides
- Architecture decision records