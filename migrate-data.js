// Data Migration Script for TalentTrack
// Cleans up and optimizes existing MongoDB data

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function migrateData() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('talenttrack');

    // ============================================
    // 1. CLEAN UP OLD DATA (Optional)
    // ============================================
    console.log('\n🧹 Cleaning up old data...');
    
    const choice = process.argv[2];
    
    if (choice === '--clean') {
      console.log('⚠️  Deleting all existing data...');
      await db.collection('users').deleteMany({});
      await db.collection('workout_sessions').deleteMany({});
      await db.collection('rep_images').deleteMany({});
      console.log('✅ All data deleted');
    } else {
      console.log('ℹ️  Keeping existing data (use --clean to delete all)');
    }

    // ============================================
    // 2. MIGRATE WORKOUT_SESSIONS
    // ============================================
    console.log('\n🔄 Migrating workout_sessions...');
    
    const sessions = await db.collection('workout_sessions').find({}).toArray();
    console.log(`   Found ${sessions.length} sessions`);

    for (const session of sessions) {
      const updates = {};
      
      // Add missing fields
      if (!session.createdAt) {
        updates.createdAt = session.timestamp || new Date();
      }
      
      // Convert string dates to Date objects
      if (typeof session.timestamp === 'string') {
        updates.timestamp = new Date(session.timestamp);
      }
      
      // Ensure numeric fields are numbers
      if (typeof session.totalReps === 'string') {
        updates.totalReps = parseInt(session.totalReps);
      }
      if (typeof session.correctReps === 'string') {
        updates.correctReps = parseInt(session.correctReps);
      }
      if (typeof session.incorrectReps === 'string') {
        updates.incorrectReps = parseInt(session.incorrectReps);
      }
      if (typeof session.duration === 'string') {
        updates.duration = parseInt(session.duration);
      }
      if (typeof session.accuracy === 'string') {
        updates.accuracy = parseInt(session.accuracy);
      }

      // Update if needed
      if (Object.keys(updates).length > 0) {
        await db.collection('workout_sessions').updateOne(
          { _id: session._id },
          { $set: updates }
        );
        console.log(`   ✅ Updated session ${session._id}`);
      }
    }

    // ============================================
    // 3. MIGRATE REP_IMAGES
    // ============================================
    console.log('\n🔄 Migrating rep_images...');
    
    const reps = await db.collection('rep_images').find({}).toArray();
    console.log(`   Found ${reps.length} rep images`);

    for (const rep of reps) {
      const updates = {};
      
      // Ensure repNumber is a number
      if (typeof rep.repNumber === 'string') {
        updates.repNumber = parseInt(rep.repNumber);
      }
      if (typeof rep.repNo === 'number' && !rep.repNumber) {
        updates.repNumber = rep.repNo;
      }
      
      // Rename imageUrl to imageData if needed
      if (rep.imageUrl && !rep.imageData) {
        updates.imageData = rep.imageUrl;
      }
      
      // Add correct field if missing
      if (rep.correct === undefined) {
        updates.correct = true; // Default to true
      }
      
      // Add details object if missing
      if (!rep.details) {
        updates.details = {};
      }

      // Update if needed
      if (Object.keys(updates).length > 0) {
        await db.collection('rep_images').updateOne(
          { _id: rep._id },
          { $set: updates }
        );
        console.log(`   ✅ Updated rep ${rep._id}`);
      }
    }

    // ============================================
    // 4. DISPLAY FINAL STATS
    // ============================================
    console.log('\n📊 Final Database Statistics:');
    
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('workout_sessions').countDocuments();
    const repsCount = await db.collection('rep_images').countDocuments();
    
    console.log(`   Users: ${usersCount}`);
    console.log(`   Workout Sessions: ${sessionsCount}`);
    console.log(`   Rep Images: ${repsCount}`);

    // Sample data from each collection
    console.log('\n📋 Sample Data:');
    
    const sampleUser = await db.collection('users').findOne({});
    if (sampleUser) {
      console.log('\n   Sample User:');
      console.log(`   - Name: ${sampleUser.name}`);
      console.log(`   - Role: ${sampleUser.role}`);
      console.log(`   - District: ${sampleUser.district}`);
    }

    const sampleSession = await db.collection('workout_sessions').findOne({});
    if (sampleSession) {
      console.log('\n   Sample Workout Session:');
      console.log(`   - Athlete: ${sampleSession.athleteName}`);
      console.log(`   - Exercise: ${sampleSession.activityName || sampleSession.exercise}`);
      console.log(`   - Total Reps: ${sampleSession.totalReps}`);
      console.log(`   - Timestamp: ${sampleSession.timestamp}`);
    }

    const sampleRep = await db.collection('rep_images').findOne({});
    if (sampleRep) {
      console.log('\n   Sample Rep Image:');
      console.log(`   - Session ID: ${sampleRep.sessionId}`);
      console.log(`   - Rep Number: ${sampleRep.repNumber || sampleRep.repNo}`);
      console.log(`   - Correct: ${sampleRep.correct}`);
    }

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Error migrating data:', error);
  } finally {
    await client.close();
    console.log('\n👋 Connection closed');
  }
}

// Run migration
console.log('🚀 Starting data migration...');
console.log('Usage: node migrate-data.js [--clean]');
console.log('  --clean: Delete all existing data before migration\n');

migrateData();
