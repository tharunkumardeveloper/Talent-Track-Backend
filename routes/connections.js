const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

// Social connections routes - Updated 2026-02-21
// Handles user discovery, connection requests, and relationship management

// Debug endpoint - Get all users
router.get('/users/all', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const users = await db.collection('users').find({}).limit(50).toArray();
    console.log('📊 All users:', users.length);
    res.json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get users to discover (exclude self and existing connections)
router.get('/users/discover', async (req, res) => {
  try {
    const { userId } = req.query;
    const db = req.app.locals.db;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log('🔍 Discovering users for:', userId);

    // First, let's see all users in the database
    const allUsers = await db.collection('users').find({}).toArray();
    console.log('📊 Total users in database:', allUsers.length);
    console.log('👥 All user IDs:', allUsers.map(u => u.userId));

    // Get existing connections
    const connections = await db.collection('connections').find({
      $or: [
        { fromUserId: userId, status: 'accepted' },
        { toUserId: userId, status: 'accepted' }
      ]
    }).toArray();

    const connectedUserIds = connections.map(c => 
      c.fromUserId === userId ? c.toUserId : c.fromUserId
    );

    console.log('🔗 Connected user IDs:', connectedUserIds);

    // Get all users except self and connected users
    const users = await db.collection('users').find({
      userId: { $ne: userId, $nin: connectedUserIds }
    }).limit(50).toArray();

    console.log('✅ Found discoverable users:', users.length);
    console.log('📋 Discoverable user names:', users.map(u => u.name));

    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching discover users:', error);
    res.status(500).json({ error: 'Failed to fetch users', details: error.message });
  }
});

// Get my connections
router.get('/connections/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    const connections = await db.collection('connections').find({
      $or: [
        { fromUserId: userId, status: 'accepted' },
        { toUserId: userId, status: 'accepted' }
      ]
    }).toArray();

    // Get user details for each connection
    const connectedUserIds = connections.map(c => 
      c.fromUserId === userId ? c.toUserId : c.fromUserId
    );

    const users = await db.collection('users').find({
      userId: { $in: connectedUserIds }
    }).toArray();

    res.json(users);
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Get pending requests (received)
router.get('/connections/requests/pending/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    const requests = await db.collection('connections').find({
      toUserId: userId,
      status: 'pending'
    }).toArray();

    // Enrich with sender details
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const user = await db.collection('users').findOne({ userId: request.fromUserId });
        return {
          ...request,
          fromUserName: user?.name,
          fromUserRole: user?.role,
          fromUserProfilePic: user?.profilePic,
          fromUserRegion: user?.district,
          fromUserSkills: user?.skills
        };
      })
    );

    res.json(enrichedRequests);
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Get sent requests
router.get('/connections/requests/sent/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    const requests = await db.collection('connections').find({
      fromUserId: userId,
      status: 'pending'
    }).toArray();

    // Enrich with recipient details
    const enrichedRequests = await Promise.all(
      requests.map(async (request) => {
        const user = await db.collection('users').findOne({ userId: request.toUserId });
        return {
          ...request,
          toUserName: user?.name,
          toUserRole: user?.role,
          toUserProfilePic: user?.profilePic
        };
      })
    );

    res.json(enrichedRequests);
  } catch (error) {
    console.error('Error fetching sent requests:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Send connection request
router.post('/connections/request', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;
    const db = req.app.locals.db;

    // Check if request already exists
    const existing = await db.collection('connections').findOne({
      $or: [
        { fromUserId, toUserId },
        { fromUserId: toUserId, toUserId: fromUserId }
      ]
    });

    if (existing) {
      return res.status(400).json({ error: 'Connection request already exists' });
    }

    const request = {
      fromUserId,
      toUserId,
      status: 'pending',
      createdAt: new Date()
    };

    await db.collection('connections').insertOne(request);
    res.json({ success: true, message: 'Connection request sent' });
  } catch (error) {
    console.error('Error sending connection request:', error);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// Accept connection request
router.post('/connections/request/:requestId/accept', async (req, res) => {
  try {
    const { requestId } = req.params;
    const db = req.app.locals.db;

    await db.collection('connections').updateOne(
      { _id: new ObjectId(requestId) },
      { 
        $set: { 
          status: 'accepted',
          acceptedAt: new Date()
        } 
      }
    );

    res.json({ success: true, message: 'Connection accepted' });
  } catch (error) {
    console.error('Error accepting request:', error);
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// Reject connection request
router.post('/connections/request/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const db = req.app.locals.db;

    await db.collection('connections').updateOne(
      { _id: new ObjectId(requestId) },
      { 
        $set: { 
          status: 'rejected',
          rejectedAt: new Date()
        } 
      }
    );

    res.json({ success: true, message: 'Connection rejected' });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// Check connection status between two users
router.get('/connections/status/:userId1/:userId2', async (req, res) => {
  try {
    const { userId1, userId2 } = req.params;
    const db = req.app.locals.db;

    const connection = await db.collection('connections').findOne({
      $or: [
        { fromUserId: userId1, toUserId: userId2 },
        { fromUserId: userId2, toUserId: userId1 }
      ]
    });

    res.json({
      connected: connection?.status === 'accepted',
      status: connection?.status || 'none',
      requestId: connection?._id
    });
  } catch (error) {
    console.error('Error checking connection status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Get user stats
router.get('/users/:userId/stats', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    const sessions = await db.collection('workout_sessions').find({ athleteId: userId }).toArray();

    const stats = {
      totalWorkouts: sessions.length,
      bestScore: Math.max(...sessions.map(s => s.totalReps || 0), 0),
      avgAccuracy: sessions.length > 0 
        ? Math.round(sessions.reduce((sum, s) => sum + (s.accuracy || 0), 0) / sessions.length)
        : 0,
      formQuality: sessions.length > 0
        ? Math.round(sessions.filter(s => s.formScore === 'Excellent').length / sessions.length * 100)
        : 0,
      consistency: sessions.length >= 5 ? 85 : sessions.length * 15
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Update user skills
router.post('/users/:userId/skills', async (req, res) => {
  try {
    const { userId } = req.params;
    const { skills } = req.body;
    const db = req.app.locals.db;

    await db.collection('users').updateOne(
      { userId },
      { $set: { skills, updatedAt: new Date() } }
    );

    res.json({ success: true, message: 'Skills updated' });
  } catch (error) {
    console.error('Error updating skills:', error);
    res.status(500).json({ error: 'Failed to update skills' });
  }
});

module.exports = router;
