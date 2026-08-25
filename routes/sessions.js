const express = require("express");
const router = express.Router();
const { getDB } = require("../db");
const { ObjectId } = require("mongodb");
const { uploadImage, uploadPDF, uploadVideo } = require("../utils/cloudinary");

// POST /api/sessions/add - Save workout session with rep images
router.post("/add", async (req, res) => {
  try {
    const db = getDB();
    const { sessionMeta, repImages } = req.body;

    console.log('💾 Saving workout session:', sessionMeta.athleteName, sessionMeta.activityName);
    console.log(`📦 Payload size - PDF: ${sessionMeta.pdfDataUrl ? (sessionMeta.pdfDataUrl.length / 1024 / 1024).toFixed(2) : 0}MB, Video: ${sessionMeta.videoDataUrl ? (sessionMeta.videoDataUrl.length / 1024 / 1024).toFixed(2) : 0}MB, Screenshots: ${repImages?.length || 0}`);

    // Upload PDF to Cloudinary if provided
    let pdfUrl = null;
    if (sessionMeta.pdfDataUrl) {
      console.log('📄 Uploading PDF to Cloudinary...');
      try {
        const publicId = `${sessionMeta.athleteName.replace(/\s+/g, '_')}_${sessionMeta.activityName.replace(/\s+/g, '_')}_${Date.now()}`;
        pdfUrl = await uploadPDF(sessionMeta.pdfDataUrl, 'talenttrack/reports', publicId);
        console.log('✅ PDF uploaded successfully:', pdfUrl);
      } catch (error) {
        console.warn('⚠️ PDF upload failed, storing base64:', error.message);
        pdfUrl = sessionMeta.pdfDataUrl; // Fallback to base64
      }
    }

    // Upload video to Cloudinary if provided
    let videoUrl = null;
    if (sessionMeta.videoDataUrl) {
      console.log('🎥 Uploading video to Cloudinary...');
      try {
        const publicId = `${sessionMeta.athleteName.replace(/\s+/g, '_')}_${sessionMeta.activityName.replace(/\s+/g, '_')}_video_${Date.now()}`;
        videoUrl = await uploadVideo(sessionMeta.videoDataUrl, 'talenttrack/videos', publicId);
        console.log('✅ Video uploaded successfully:', videoUrl);
      } catch (error) {
        console.warn('⚠️ Video upload failed, storing base64:', error.message);
        videoUrl = sessionMeta.videoDataUrl; // Fallback to base64
      }
    }

    // Insert session metadata with Cloudinary URLs
    const sessionResult = await db.collection("workout_sessions").insertOne({
      ...sessionMeta,
      pdfUrl,
      videoUrl,
      pdfDataUrl: undefined, // Remove base64
      videoDataUrl: undefined, // Remove base64
      timestamp: new Date(sessionMeta.timestamp),
      createdAt: new Date()
    });

    console.log('✅ Session saved with ID:', sessionResult.insertedId);

    // Upload rep images to Cloudinary with duplicate prevention
    if (repImages && repImages.length > 0) {
      console.log(`📸 Uploading ${repImages.length} rep images to Cloudinary...`);
      
      // Remove any existing rep images for this session (cleanup)
      await db.collection("rep_images").deleteMany({ 
        sessionId: sessionResult.insertedId.toString() 
      });
      
      const repsWithUrls = await Promise.all(
        repImages.map(async (rep) => {
          try {
            const publicId = `${sessionMeta.athleteName.replace(/\s+/g, '_')}_${sessionMeta.activityName.replace(/\s+/g, '_')}_rep${rep.repNumber}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const imageUrl = await uploadImage(rep.imageData, 'talenttrack/screenshots', publicId);
            console.log(`✅ Rep ${rep.repNumber} uploaded: ${imageUrl.substring(0, 50)}...`);
            
            return {
              repNumber: rep.repNumber,
              imageUrl,
              correct: rep.correct,
              details: rep.details || {},
              sessionId: sessionResult.insertedId.toString(),
              createdAt: new Date()
            };
          } catch (error) {
            console.warn(`⚠️ Rep ${rep.repNumber} upload failed, storing base64:`, error.message);
            return {
              repNumber: rep.repNumber,
              imageUrl: rep.imageData, // Fallback to base64
              correct: rep.correct,
              details: rep.details || {},
              sessionId: sessionResult.insertedId.toString(),
              createdAt: new Date()
            };
          }
        })
      );

      // Use insertMany with ordered: false to continue on duplicates
      try {
        await db.collection("rep_images").insertMany(repsWithUrls, { ordered: false });
        console.log(`✅ Saved ${repImages.length} rep images to MongoDB`);
      } catch (error) {
        // Handle duplicate key errors gracefully
        if (error.code === 11000) {
          console.warn('⚠️ Some duplicate rep images were skipped');
        } else {
          throw error;
        }
      }
    }

    res.status(200).json({
      success: true,
      sessionId: sessionResult.insertedId.toString(),
      pdfUrl,
      videoUrl,
      message: 'Session and reps saved successfully!'
    });

  } catch (err) {
    console.error('❌ Error saving workout:', err);
    res.status(500).json({
      success: false,
      error: 'Error saving workout data',
      details: err.message
    });
  }
});

// GET /api/sessions/athlete/:athleteName - Get all workouts for an athlete
router.get("/athlete/:athleteName", async (req, res) => {
  try {
    const db = getDB();
    const { athleteName } = req.params;

    console.log('📊 Fetching workouts for:', athleteName);

    const workouts = await db.collection("workout_sessions")
      .find({ athleteName })
      .sort({ timestamp: -1 })
      .toArray();

    console.log(`✅ Found ${workouts.length} workouts for ${athleteName}`);

    // Fetch rep images for each workout
    const workoutsWithReps = await Promise.all(
      workouts.map(async (workout) => {
        const reps = await db.collection("rep_images")
          .find({ sessionId: workout._id.toString() })
          .sort({ repNumber: 1 })
          .toArray();
        
        console.log(`📸 Found ${reps.length} rep images for workout ${workout._id}`);
        if (reps.length > 0) {
          console.log(`   First rep URL: ${reps[0].imageUrl?.substring(0, 60)}...`);
        }
        
        return {
          ...workout,
          screenshots: reps.map(rep => rep.imageUrl),
          repDetails: reps.map(rep => ({
            rep: rep.repNumber,
            correct: rep.correct,
            ...rep.details
          }))
        };
      })
    );

    res.status(200).json({
      success: true,
      workouts: workoutsWithReps,
      count: workoutsWithReps.length
    });

  } catch (err) {
    console.error('❌ Error fetching workouts:', err);
    res.status(500).json({
      success: false,
      error: 'Error fetching workouts',
      details: err.message,
      workouts: [] // Return empty array on error
    });
  }
});

// GET /api/sessions/all-athletes - Get all athletes with workout counts
router.get("/all-athletes", async (req, res) => {
  try {
    const db = getDB();

    console.log('👥 Fetching all athletes...');

    const athletes = await db.collection("workout_sessions").aggregate([
      {
        $group: {
          _id: "$athleteName",
          workoutCount: { $sum: 1 },
          lastWorkout: { $max: "$timestamp" },
          athleteProfilePic: { $first: "$athleteProfilePic" }
        }
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          workoutCount: 1,
          lastWorkout: 1,
          athleteProfilePic: 1
        }
      },
      {
        $sort: { lastWorkout: -1 }
      }
    ]).toArray();

    console.log(`✅ Found ${athletes.length} athletes`);

    res.status(200).json({
      success: true,
      athletes,
      count: athletes.length
    });

  } catch (err) {
    console.error('❌ Error fetching athletes:', err);
    res.status(500).json({
      success: false,
      error: 'Error fetching athletes',
      details: err.message
    });
  }
});

// GET /api/sessions/:sessionId/reps - Get rep images for a specific workout session
router.get("/:sessionId/reps", async (req, res) => {
  try {
    const db = getDB();
    const { sessionId } = req.params;

    console.log('🖼️ Fetching rep images for session:', sessionId);

    const reps = await db.collection("rep_images")
      .find({ sessionId })
      .sort({ repNumber: 1 })
      .toArray();

    console.log(`✅ Found ${reps.length} rep images`);

    res.status(200).json({
      success: true,
      reps,
      count: reps.length
    });

  } catch (err) {
    console.error('❌ Error fetching rep images:', err);
    res.status(500).json({
      success: false,
      error: 'Error fetching rep images',
      details: err.message
    });
  }
});

// DELETE /api/sessions/:sessionId - Delete workout session and all related data
router.delete("/:sessionId", async (req, res) => {
  try {
    const db = getDB();
    const { sessionId } = req.params;

    console.log('🗑️ Deleting workout session:', sessionId);

    // Validate sessionId
    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session ID'
      });
    }

    // Delete rep images associated with this session
    const repImagesResult = await db.collection("rep_images").deleteMany({
      sessionId: sessionId
    });
    console.log(`✅ Deleted ${repImagesResult.deletedCount} rep images`);

    // Delete the workout session
    const sessionResult = await db.collection("workout_sessions").deleteOne({
      _id: new ObjectId(sessionId)
    });

    if (sessionResult.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workout session not found'
      });
    }

    console.log('✅ Workout session deleted successfully');

    res.status(200).json({
      success: true,
      message: 'Workout session deleted successfully',
      deletedRepImages: repImagesResult.deletedCount
    });

  } catch (err) {
    console.error('❌ Error deleting workout session:', err);
    res.status(500).json({
      success: false,
      error: 'Error deleting workout session',
      details: err.message
    });
  }
});


// Ported from the previously-deployed backend (rec-backend-main). The
// frontend calls this route, so dropping it would break live pages.
router.get("/user/:userId", async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;

    console.log('📊 Fetching workouts for userId:', userId);

    // First, get the user to find their name
    const user = await db.collection("users").findOne({ userId });
    console.log('👤 User found:', user ? user.name : 'Not found');
    
    // Search by athleteId, exact athleteName match, or partial name match
    // This handles cases where workout has "Tharun" but user is "Tharun Kumar"
    const query = user 
      ? { 
          $or: [
            { athleteId: userId }, 
            { athleteName: user.name },
            { athleteName: { $regex: new RegExp(user.name.split(' ')[0], 'i') } } // Match first name
          ] 
        }
      : { athleteId: userId };

    console.log('🔍 Query:', JSON.stringify(query));

    const workouts = await db.collection("workout_sessions")
      .find(query)
      .sort({ timestamp: -1 })
      .toArray();

    console.log(`✅ Found ${workouts.length} workouts for user ${userId}`);
    
    // If no workouts found, let's check what names exist in workouts
    if (workouts.length === 0 && user) {
      const allWorkouts = await db.collection("workout_sessions")
        .find({})
        .limit(5)
        .toArray();
      console.log('📋 Sample workout names:', allWorkouts.map(w => ({ name: w.athleteName, id: w.athleteId })));
    }

    // Fetch rep images for each workout
    const workoutsWithReps = await Promise.all(
      workouts.map(async (workout) => {
        const reps = await db.collection("rep_images")
          .find({ sessionId: workout._id.toString() })
          .sort({ repNumber: 1 })
          .toArray();
        
        return {
          ...workout,
          screenshots: reps.map(rep => rep.imageUrl),
          repDetails: reps.map(rep => ({
            rep: rep.repNumber,
            correct: rep.correct,
            ...rep.details
          }))
        };
      })
    );

    res.status(200).json({
      success: true,
      workouts: workoutsWithReps,
      count: workoutsWithReps.length
    });

  } catch (err) {
    console.error('❌ Error fetching workouts:', err);
    res.status(500).json({
      success: false,
      error: 'Error fetching workouts',
      details: err.message,
      workouts: [] // Return empty array on error
    });
  }
});

// Ported from the previously-deployed backend (rec-backend-main). The
// frontend calls this route, so dropping it would break live pages.
router.get("/:sessionId", async (req, res) => {
  try {
    const db = getDB();
    const { sessionId } = req.params;

    console.log('📊 Fetching workout session:', sessionId);

    // Validate sessionId
    if (!ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid session ID'
      });
    }

    const workout = await db.collection("workout_sessions")
      .findOne({ _id: new ObjectId(sessionId) });

    if (!workout) {
      return res.status(404).json({
        success: false,
        error: 'Workout not found'
      });
    }

    // Fetch rep images for this workout
    const reps = await db.collection("rep_images")
      .find({ sessionId: workout._id.toString() })
      .sort({ repNumber: 1 })
      .toArray();

    console.log(`✅ Found workout with ${reps.length} rep images`);

    const workoutWithReps = {
      ...workout,
      screenshots: reps.map(rep => rep.imageUrl),
      repDetails: reps.map(rep => ({
        rep: rep.repNumber,
        correct: rep.correct,
        ...rep.details
      }))
    };

    res.status(200).json(workoutWithReps);

  } catch (err) {
    console.error('❌ Error fetching workout:', err);
    res.status(500).json({
      success: false,
      error: 'Error fetching workout',
      details: err.message
    });
  }
});

module.exports = router;
