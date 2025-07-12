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

2. Set up Firebase configuration:
   - Copy `env.example` to `.env`
   - Replace the placeholder value in `.env` with your actual Firebase API key
   - You can find this value in your Firebase Console → Project Settings → General → Your apps

3. Open `index.html` in your browser or use a local server:
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve
```

4. Visit `http://localhost:8000` in your browser

### Firebase Configuration

This application uses Firebase for data storage. To set up Firebase:

1. Create a Firebase project at [https://console.firebase.google.com](https://console.firebase.google.com)
2. Enable Firestore Database
3. Get your project configuration from Project Settings → General → Your apps
4. Create a `.env` file in the project root with the following variable:
   ```
   FIREBASE_API_KEY=your_firebase_api_key_here
   ```

### Deployment with GitHub Secrets

For production deployment:

1. Add your Firebase API key as a GitHub secret:
   - Go to your repository → Settings → Secrets and variables → Actions
   - Create a new secret named `FIREBASE_API_KEY`
   - Set the value to your actual Firebase API key

2. The GitHub Actions workflow will automatically:
   - Create the `.env` file during deployment
   - Deploy to GitHub Pages with the secure configuration

## Usage

1. Create teams and add team members
2. Start matches between teams
3. Enter round scores as the game progresses
4. View team statistics and match history
5. Track team rankings and performance

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