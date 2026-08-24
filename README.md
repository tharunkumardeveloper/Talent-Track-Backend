# TalentTrack Backend Server

Node.js backend for TalentTrack workout tracking system with MongoDB Atlas integration.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
```

3. Update `.env` with your MongoDB credentials:
```env
MONGODB_URI=mongodb+srv://talenttrack_user:YourPassword@cluster0.rzbfab5.mongodb.net/talenttrack?retryWrites=true&w=majority
PORT=3001
```

4. Test MongoDB connection:
```bash
node test-mongodb.js
```

5. Start server:
```bash
npm start
```

## API Endpoints

- `POST /api/sessions/add` - Save workout session
- `GET /api/sessions/all-athletes` - Get all athletes
- `GET /api/sessions/athlete/:name` - Get athlete workouts
- `GET /api/sessions/:id/reps` - Get rep images
- `DELETE /api/sessions/:id` - Delete workout

## Tech Stack

- Express.js
- MongoDB Atlas
- CORS enabled
