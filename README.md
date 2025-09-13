# Claude Context Documentation

This folder contains comprehensive documentation for the Card Game Dashboard project, created specifically to provide Claude with detailed context about the project structure, implementation, and functionality.

## Documentation Files

### 📋 [Project Overview](./project-overview.md)
Complete project description, technology stack, architecture patterns, and feature overview. Essential starting point for understanding the application.

### 🏗️ [Architecture Overview](./architecture-overview.md)
Detailed system architecture, design patterns, component relationships, and scalability considerations. Covers MVC pattern, service layer, and data flow.

### 📚 [API Documentation](./api-documentation.md)
Comprehensive API documentation for all services, methods, parameters, and return types. Includes Firebase service, team service, and match service APIs.

### 🎮 [Game Rules and Conditions](./game-rules-and-conditions.md)
Complete documentation of game rules, validation conditions, scoring mechanisms, and business logic. Essential for understanding the card game implementation.

### 🗄️ [Database Schema](./database-schema.md)
Detailed Firestore database schema, document structures, relationships, and data validation rules. Includes performance optimization and scaling considerations.

### 🚀 [Setup and Development](./setup-and-development.md)
Complete setup guide, development workflow, testing strategies, debugging tips, and deployment procedures. Everything needed to run and develop the application.

## Quick Reference

### Key Technologies
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Firebase Firestore, Firebase Authentication
- **3D Graphics**: Spline 3D viewer
- **Deployment**: Firebase Hosting, GitHub Pages

### Main Components
- **Models**: `Team.js`, `Match.js` - Business logic and data structures
- **Services**: `firebaseService.js`, `teamService.js`, `matchService.js` - API and business operations
- **Utils**: `dateUtils.js`, `storage.js`, `env.js` - Helper functions and utilities
- **Controller**: `app.js` - Main application logic and UI management

### Core Features
1. **Team Management** - Create teams, track statistics, manage members
2. **Match System** - Head-to-head matches with round-by-round scoring
3. **Game Rules** - Promise vs actual hand validation, 500-point win condition
4. **Real-time Updates** - Firebase listeners for live data synchronization
5. **Statistics** - Comprehensive team rankings and performance metrics
6. **Authentication** - Key-based authentication for administrative actions

### Game Rules Summary
- **Teams**: 2 teams per match, multiple members per team
- **Rounds**: Promise 4-13 hands, actual hands must sum to 13
- **Scoring**: `Score = |Promise - Actual| × 10` (lower is better)
- **Win Condition**: First team to 500 points wins
- **Statistics**: Wins/losses, points, rounds won/lost, match history

### Database Collections
- **teams**: Team data, statistics, and match history
- **matches**: Match details, rounds, scores, and audit trail

### Environment Variables
- `FIREBASE_API_KEY`: Firebase project API key
- `AUTH_KEY`: Administrative authentication key

## Using This Documentation

### For Feature Development
1. Review **Game Rules** for business logic requirements
2. Check **API Documentation** for available methods
3. Consult **Database Schema** for data structures
4. Reference **Architecture Overview** for design patterns

### For Bug Fixes
1. Check **Game Rules** for validation logic
2. Review **API Documentation** for method signatures
3. Consult **Database Schema** for data relationships
4. Use **Setup Guide** for debugging techniques

### For System Understanding
1. Start with **Project Overview** for general context
2. Read **Architecture Overview** for system design
3. Study **Database Schema** for data modeling
4. Review **API Documentation** for implementation details

### For Deployment/Setup
1. Follow **Setup and Development** guide step by step
2. Reference **Database Schema** for Firebase configuration
3. Check **Project Overview** for environment requirements

## Context Usage Guidelines

When working with this project:

1. **Always validate against game rules** - The scoring system and validation rules are complex
2. **Maintain data consistency** - Team statistics must stay synchronized with match data
3. **Handle authentication properly** - Administrative actions require key-based auth
4. **Consider real-time updates** - UI should reflect Firebase changes automatically
5. **Follow established patterns** - Use existing service layer and model patterns
6. **Validate user inputs** - All inputs have specific validation requirements
7. **Test thoroughly** - Game rules have many edge cases and validation scenarios

## File Locations Quick Reference

### Models
- `js/models/Team.js` - Team entity and statistics
- `js/models/Match.js` - Match entity and game rules

### Services
- `js/services/firebaseService.js` - Database operations
- `js/services/teamService.js` - Team business logic
- `js/services/matchService.js` - Match management
- `js/services/migrationService.js` - Data migration

### Utils
- `js/utils/firebaseConfig.js` - Firebase configuration
- `js/utils/dateUtils.js` - Date handling utilities
- `js/utils/storage.js` - Local storage management
- `js/utils/env.js` - Environment variable loading

### Configuration
- `firebase.json` - Firebase project configuration
- `firestore.rules` - Database security rules
- `.env` - Environment variables (local development)

This documentation provides comprehensive context for understanding and working with the Card Game Dashboard project. Each file contains detailed information about specific aspects of the system, enabling informed development and maintenance decisions.