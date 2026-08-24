const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const fetch = require('node-fetch');

// Face verification using DeepFace backend
router.post('/verify-face', async (req, res) => {
  try {
    const { athleteId, liveImage } = req.body;

    if (!athleteId || !liveImage) {
      return res.status(400).json({
        verified: false,
        confidence: 0,
        message: 'Missing required fields',
        anomalyFlag: true
      });
    }

    // Get athlete's registered profile image from database
    const db = req.app.locals.db;
    const user = await db.collection('users').findOne({
      _id: new ObjectId(athleteId)
    });

    if (!user || !user.profileImage) {
      return res.status(404).json({
        verified: false,
        confidence: 0,
        message: 'No registered profile image found',
        anomalyFlag: true
      });
    }

    // Call DeepFace API for face comparison
    const deepfaceUrl = process.env.DEEPFACE_API_URL || 'http://localhost:5000';
    
    try {
      const deepfaceResponse = await fetch(`${deepfaceUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          img1_base64: user.profileImage,
          img2_base64: liveImage,
          model_name: 'Facenet',
          detector_backend: 'opencv',
          distance_metric: 'cosine'
        }),
        timeout: 10000
      });

      if (!deepfaceResponse.ok) {
        throw new Error('DeepFace API error');
      }

      const result = await deepfaceResponse.json();
      
      // DeepFace returns distance (lower is better), convert to confidence
      const confidence = result.verified ? (1 - result.distance) : 0;
      const verified = result.verified && confidence >= 0.85;

      // Log verification attempt
      await db.collection('verification_logs').insertOne({
        athleteId: new ObjectId(athleteId),
        verified,
        confidence,
        timestamp: new Date(),
        anomalyFlag: !verified
      });

      res.json({
        verified,
        confidence,
        message: verified ? 'Identity verified successfully' : 'Face does not match registered profile',
        anomalyFlag: !verified
      });

    } catch (deepfaceError) {
      console.error('DeepFace error:', deepfaceError);
      
      // Fallback: Allow verification but flag for manual review
      res.json({
        verified: false,
        confidence: 0,
        message: 'Face verification service temporarily unavailable',
        anomalyFlag: true
      });
    }

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      verified: false,
      confidence: 0,
      message: 'Internal server error',
      anomalyFlag: true
    });
  }
});

// Save verification result to session
router.post('/sessions/:sessionId/verification', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { athleteId, face_verified, verification_confidence, anomaly_flag, verified_at } = req.body;

    const db = req.app.locals.db;
    
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(sessionId) },
      {
        $set: {
          face_verified,
          verification_confidence,
          anomaly_flag,
          verified_at: new Date(verified_at)
        }
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Save verification error:', error);
    res.status(500).json({ error: 'Failed to save verification result' });
  }
});

// Get athlete profile image
router.get('/users/:userId/profile-image', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = req.app.locals.db;

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { profileImage: 1 } }
    );

    if (!user || !user.profileImage) {
      return res.status(404).json({ error: 'Profile image not found' });
    }

    res.json({ profileImage: user.profileImage });
  } catch (error) {
    console.error('Get profile image error:', error);
    res.status(500).json({ error: 'Failed to retrieve profile image' });
  }
});

module.exports = router;
