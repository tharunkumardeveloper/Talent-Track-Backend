// MongoDB Utility API Routes for TalentTrack
// Web-accessible endpoints to view and manage data (no shell access needed)

const express = require('express');
const router = express.Router();
const { getDB } = require('./db');
const { ObjectId } = require('mongodb');

// Health check
router.get('/health', async (req, res) => {
  try {
    const db = getDB();
    await db.command({ ping: 1 });
    res.json({ status: 'MongoDB connected', database: db.databaseName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Database statistics
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('workout_sessions').countDocuments();
    const repsCount = await db.collection('rep_images').countDocuments();
    
    // Role breakdown
    const athletes = await db.collection('users').countDocuments({ role: 'ATHLETE' });
    const coaches = await db.collection('users').countDocuments({ role: 'COACH' });
    const admins = await db.collection('users').countDocuments({ role: 'SAI_ADMIN' });
    
    // Activity breakdown
    const activities = await db.collection('workout_sessions').aggregate([
      { $group: { _id: '$activityName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    res.json({
      users: usersCount,
      workoutSessions: sessionsCount,
      repImages: repsCount,
      roles: { athletes, coaches, admins },
      activities
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all users
router.get('/users', async (req, res) => {
  try {
    const db = getDB();
    const users = await db.collection('users').find({}).toArray();
    res.json({ success: true, users, count: users.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all workout sessions
router.get('/sessions', async (req, res) => {
  try {
    const db = getDB();
    const limit = parseInt(req.query.limit) || 20;
    const sessions = await db.collection('workout_sessions')
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    res.json({ success: true, sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single workout by ID
router.get('/sessions/:id', async (req, res) => {
  try {
    const db = getDB();
    const session = await db.collection('workout_sessions').findOne({ 
      _id: new ObjectId(req.params.id) 
    });
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List rep images
router.get('/reps', async (req, res) => {
  try {
    const db = getDB();
    const limit = parseInt(req.query.limit) || 20;
    const sessionId = req.query.sessionId;
    
    const query = sessionId ? { sessionId } : {};
    const reps = await db.collection('rep_images')
      .find(query)
      .limit(limit)
      .toArray();
    
    res.json({ success: true, reps, count: reps.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Show athletes with workout counts
router.get('/athletes', async (req, res) => {
  try {
    const db = getDB();
    
    const athletes = await db.collection('workout_sessions').aggregate([
      {
        $group: {
          _id: '$athleteName',
          workoutCount: { $sum: 1 },
          lastWorkout: { $max: '$timestamp' },
          activities: { $addToSet: '$activityName' }
        }
      },
      { $sort: { workoutCount: -1 } }
    ]).toArray();
    
    res.json({ 
      success: true, 
      athletes: athletes.map(a => ({
        name: a._id,
        workoutCount: a.workoutCount,
        lastWorkout: a.lastWorkout,
        activities: a.activities.filter(act => act)
      })),
      count: athletes.length 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
