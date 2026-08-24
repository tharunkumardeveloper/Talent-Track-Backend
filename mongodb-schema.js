// MongoDB Schema Setup for TalentTrack
// Run this file once to create collections with proper indexes

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function setupDatabase() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('talenttrack');

    // ============================================
    // 1. USERS COLLECTION
    // ============================================
    console.log('\n📋 Setting up users collection...');
    
    const usersExists = await db.listCollections({ name: 'users' }).hasNext();
    if (!usersExists) {
      await db.createCollection('users', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['userId', 'name', 'role'],
            properties: {
              userId: { bsonType: 'string', description: 'Unique user ID' },
              name: { bsonType: 'string', description: 'User full name' },
              role: { 
                enum: ['ATHLETE', 'COACH', 'SAI_ADMIN'],
                description: 'User role'
              },
              district: { bsonType: 'string', description: 'User district' },
              email: { bsonType: 'string', description: 'User email' },
              profilePic: { bsonType: 'string', description: 'Profile picture URL/base64' },
              profileImage: { bsonType: 'string', description: 'Face verification reference image (base64)' },
              skills: { 
                bsonType: 'array',
                items: { bsonType: 'string' },
                description: 'User skills/specializations'
              },
              createdAt: { bsonType: 'date', description: 'Account creation date' }
            }
          }
        }
      });
      console.log('✅ Users collection created');
    }

    // Create indexes for users (production-safe)
    try {
      await db.collection('users').createIndex({ userId: 1 }, { unique: true, background: true });
      await db.collection('users').createIndex({ role: 1 }, { background: true });
      await db.collection('users').createIndex({ district: 1 }, { background: true });
      console.log('✅ Users indexes created');
    } catch (indexErr) {
      if (!indexErr.message.includes('already exists')) {
        console.warn('⚠️ Users index warning:', indexErr.message);
      } else {
        console.log('✅ Users indexes already exist');
      }
    }

    // ============================================
    // 2. WORKOUT_SESSIONS COLLECTION
    // ============================================
    console.log('\n📋 Setting up workout_sessions collection...');
    
    const sessionsExists = await db.listCollections({ name: 'workout_sessions' }).hasNext();
    if (!sessionsExists) {
      await db.createCollection('workout_sessions', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['athleteName', 'activityName', 'totalReps', 'timestamp'],
            properties: {
              athleteName: { bsonType: 'string', description: 'Athlete name' },
              athleteId: { bsonType: 'string', description: 'Athlete user ID' },
              athleteProfilePic: { bsonType: 'string', description: 'Athlete profile picture' },
              activityName: { bsonType: 'string', description: 'Exercise name (Squats, Push-ups, etc.)' },
              totalReps: { bsonType: 'int', minimum: 0, description: 'Total reps completed' },
              correctReps: { bsonType: 'int', minimum: 0, description: 'Correct form reps' },
              incorrectReps: { bsonType: 'int', minimum: 0, description: 'Incorrect form reps' },
              duration: { bsonType: 'int', minimum: 0, description: 'Workout duration in seconds' },
              accuracy: { bsonType: 'int', minimum: 0, maximum: 100, description: 'Form accuracy percentage' },
              formScore: { bsonType: 'string', description: 'Form score (Excellent, Good, Needs Work)' },
              timestamp: { bsonType: 'date', description: 'Workout completion time' },
              videoDataUrl: { bsonType: 'string', description: 'Base64 encoded video' },
              pdfDataUrl: { bsonType: 'string', description: 'Base64 encoded PDF report' },
              face_verified: { bsonType: 'bool', description: 'Whether face verification passed' },
              verification_confidence: { bsonType: 'double', minimum: 0, maximum: 1, description: 'Face match confidence score' },
              anomaly_flag: { bsonType: 'bool', description: 'Whether substitution was detected' },
              verified_at: { bsonType: 'date', description: 'Verification timestamp' },
              createdAt: { bsonType: 'date', description: 'Record creation time' }
            }
          }
        }
      });
      console.log('✅ Workout_sessions collection created');
    }

    // Create indexes for workout_sessions (production-safe)
    try {
      await db.collection('workout_sessions').createIndex({ athleteName: 1, timestamp: -1 }, { background: true });
      await db.collection('workout_sessions').createIndex({ athleteId: 1, timestamp: -1 }, { background: true });
      await db.collection('workout_sessions').createIndex({ activityName: 1 }, { background: true });
      await db.collection('workout_sessions').createIndex({ timestamp: -1 }, { background: true });
      await db.collection('workout_sessions').createIndex({ createdAt: -1 }, { background: true });
      console.log('✅ Workout_sessions indexes created');
    } catch (indexErr) {
      if (!indexErr.message.includes('already exists')) {
        console.warn('⚠️ Workout_sessions index warning:', indexErr.message);
      } else {
        console.log('✅ Workout_sessions indexes already exist');
      }
    }

    // ============================================
    // 3. REP_IMAGES COLLECTION
    // ============================================
    console.log('\n📋 Setting up rep_images collection...');
    
    const repsExists = await db.listCollections({ name: 'rep_images' }).hasNext();
    if (!repsExists) {
      await db.createCollection('rep_images', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['sessionId', 'repNumber'],
            properties: {
              sessionId: { bsonType: 'string', description: 'Reference to workout_sessions._id' },
              repNumber: { bsonType: 'int', minimum: 1, description: 'Rep sequence number' },
              imageData: { bsonType: 'string', description: 'Base64 encoded image' },
              correct: { bsonType: 'bool', description: 'Whether rep form was correct' },
              details: { 
                bsonType: 'object',
                description: 'Rep metrics (angles, etc.)',
                properties: {
                  angle: { bsonType: 'number' },
                  knee_angle: { bsonType: 'number' },
                  elbow_angle: { bsonType: 'number' },
                  plank_angle: { bsonType: 'number' }
                }
              }
            }
          }
        }
      });
      console.log('✅ Rep_images collection created');
    }

    // Create indexes for rep_images (production-safe)
    try {
      await db.collection('rep_images').createIndex({ sessionId: 1, repNumber: 1 }, { unique: true, background: true });
      await db.collection('rep_images').createIndex({ sessionId: 1 }, { background: true });
      console.log('✅ Rep_images indexes created (with unique constraint on sessionId + repNumber)');
    } catch (indexErr) {
      if (!indexErr.message.includes('already exists')) {
        console.warn('⚠️ Rep_images index warning:', indexErr.message);
      } else {
        console.log('✅ Rep_images indexes already exist');
      }
    }

    // ============================================
    // 4. CONNECTIONS COLLECTION (NEW - Social Features)
    // ============================================
    console.log('\n📋 Setting up connections collection...');
    
    const connectionsExists = await db.listCollections({ name: 'connections' }).hasNext();
    if (!connectionsExists) {
      await db.createCollection('connections', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['fromUserId', 'toUserId', 'status'],
            properties: {
              fromUserId: { bsonType: 'string', description: 'User who sent the request' },
              toUserId: { bsonType: 'string', description: 'User who received the request' },
              status: { 
                enum: ['pending', 'accepted', 'rejected'],
                description: 'Connection status'
              },
              createdAt: { bsonType: 'date', description: 'Request creation time' },
              acceptedAt: { bsonType: 'date', description: 'Request acceptance time' },
              rejectedAt: { bsonType: 'date', description: 'Request rejection time' }
            }
          }
        }
      });
      console.log('✅ Connections collection created');
    }

    // Create indexes for connections (production-safe)
    try {
      await db.collection('connections').createIndex({ fromUserId: 1, toUserId: 1 }, { unique: true, background: true });
      await db.collection('connections').createIndex({ fromUserId: 1, status: 1 }, { background: true });
      await db.collection('connections').createIndex({ toUserId: 1, status: 1 }, { background: true });
      console.log('✅ Connections indexes created');
    } catch (indexErr) {
      if (!indexErr.message.includes('already exists')) {
        console.warn('⚠️ Connections index warning:', indexErr.message);
      } else {
        console.log('✅ Connections indexes already exist');
      }
    }

    // ============================================
    // 5. DISPLAY CURRENT STATS
    // ============================================
    console.log('\n📊 Database Statistics:');
    
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('workout_sessions').countDocuments();
    const repsCount = await db.collection('rep_images').countDocuments();
    const connectionsCount = await db.collection('connections').countDocuments();
    
    console.log(`   Users: ${usersCount}`);
    console.log(`   Workout Sessions: ${sessionsCount}`);
    console.log(`   Rep Images: ${repsCount}`);
    console.log(`   Connections: ${connectionsCount}`);

    // ============================================
    // 6. SAMPLE DATA (Optional)
    // ============================================
    console.log('\n💡 Sample queries you can run:');
    console.log('   - Get all athletes: db.users.find({ role: "ATHLETE" })');
    console.log('   - Get athlete workouts: db.workout_sessions.find({ athleteName: "Ratheesh" })');
    console.log('   - Get rep images: db.rep_images.find({ sessionId: "session_001" })');

    console.log('\n✅ Database setup complete!');

  } catch (error) {
    console.error('❌ Error setting up database:', error);
  } finally {
    await client.close();
    console.log('\n👋 Connection closed');
  }
}

// Run setup
setupDatabase();
