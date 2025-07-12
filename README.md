# Card Game Score Tracker

A web application for tracking scores and statistics in card games. Built with vanilla JavaScript, HTML, and CSS.

## Features

- Team management with member tracking
- Match creation and scoring
- Round-by-round score tracking
- Team statistics and rankings
- Match history and activity feed
- Responsive design

## Live Demo

Visit the live demo at: [https://yourusername.github.io/card-game-tracker](https://yourusername.github.io/card-game-tracker)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/card-game-tracker.git
cd card-game-tracker
```

2. Set up environment variables:
   - Copy `env.example` to `.env`
   - Replace the placeholder values in `.env` with your actual configuration:
     - `FIREBASE_API_KEY`: Your Firebase API key (from Firebase Console → Project Settings → General → Your apps)
     - `AUTH_KEY`: Your authentication key for administrative actions (change from default 'redtoto' in production)

3. Open `index.html` in your browser or use a local server:
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve
```

4. Visit `http://localhost:8000` in your browser

### Environment Configuration

This application uses environment variables for secure configuration. To set up:

1. **Firebase Configuration**:
   - Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com)
   - Enable Firestore Database
   - Get your project configuration from Project Settings → General → Your apps

2. **Authentication Key**:
   - The `AUTH_KEY` is used for administrative actions like adding teams, creating matches, and submitting rounds
   - Change the default key 'redtoto' to a secure key in production
   - Keep this key secret and share it only with authorized users

3. **Create `.env` file** in the project root with:
   ```
   FIREBASE_API_KEY=your_firebase_api_key_here
   AUTH_KEY=your_secure_authentication_key_here
   ```

### Deployment with GitHub Secrets

For production deployment:

1. Add your environment variables as GitHub secrets:
   - Go to your repository → Settings → Secrets and variables → Actions
   - Create secrets for:
     - `FIREBASE_API_KEY`: Your Firebase API key
     - `AUTH_KEY`: Your secure authentication key

2. The GitHub Actions workflow will automatically:
   - Create the `.env` file during deployment with your secrets
   - Deploy to GitHub Pages with the secure configuration

## Usage

1. **Authentication**: Enter the authentication key when prompted for administrative actions
2. Create teams and add team members
3. Start matches between teams
4. Enter round scores as the game progresses
5. View team statistics and match history
6. Track team rankings and performance

## Security

- The authentication key controls access to administrative functions
- Change the default key 'redtoto' to a secure key in production
- Keep your `.env` file secure and never commit it to version control
- The `.env` file is already included in `.gitignore` for security

## Technologies Used

- HTML5
- CSS3
- Vanilla JavaScript
- Local Storage for data persistence
- GitHub Pages for hosting

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built as a simple and efficient way to track card game scores
- No external dependencies required
- Easy to use and maintain 