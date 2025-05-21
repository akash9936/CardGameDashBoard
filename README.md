# Card Game Dashboard

A simple card game management system that helps track and manage card game matches between teams.

## Features

- Team Management
  - Create and manage teams
  - Track team statistics and performance
  - View team rankings

- Match Management
  - Create new matches between teams
  - Record match results
  - Track match history

- Statistics & History
  - View team performance over time
  - Track win/loss records
  - Access complete match history
  - Restore previous match states

## Project Structure

- `index.html` - Main dashboard page
- `css/` - Stylesheet files
  - `styles.css` - Main stylesheet
- `js/` - JavaScript files
  - `models/` - Data models
    - `Team.js` - Team model
    - `Match.js` - Match model
  - `services/` - Business logic
    - `teamService.js` - Team management
    - `matchService.js` - Match management
  - `utils/` - Utility functions
    - `storage.js` - Local storage management
- `data/` - Data storage
  - `gameData.json` - Persistent game data

## How to Use

1. Open `index.html` in a web browser
2. Use the dashboard to:
   - Create and manage teams
   - Record matches
   - View statistics and history

## Data Storage

All data is stored locally in `data/gameData.json`. The system maintains:
- Team information
- Match history
- Statistics and rankings

## Technical Details

- Built with vanilla HTML, CSS, and JavaScript
- No external dependencies
- Local JSON storage for data persistence
- Responsive design for all screen sizes 