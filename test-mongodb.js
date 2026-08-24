const { connectDB, getDB, closeDB } = require('./db');

async function testMongoDB() {
  console.log('🧪 Testing MongoDB connection...\n');

  try {
    // Connect to database
    await connectDB();
    console.log('✅ Connected successfully!\n');

    const db = getDB();

    // Test 1: Insert a test workout
    console.log('📝 Test 1: Inserting test workout...');
    const testWorkout = {
      athleteName: 'Test Athlete',
      activityName: 'Test Squats',
      totalReps: 5,
      correctReps: 4,
      incorrectReps: 1,
      duration: 60,
      accuracy: 80,
      formScore: 'Good',
      timestamp: new Date(),
      createdAt: new Date()
    };

    const result = await db.collection('workout_sessions').insertOne(testWorkout);
    console.log('✅ Workout inserted with ID:', result.insertedId.toString());

    // Test 2: Fetch the workout
    console.log('\n📊 Test 2: Fetching workout...');
    const fetched = await db.collection('workout_sessions').findOne({ _id: result.insertedId });
    console.log('✅ Workout fetched:', {
      athleteName: fetched.athleteName,
      activityName: fetched.activityName,
      totalReps: fetched.totalReps
    });

    // Test 3: Count all workouts
    console.log('\n🔢 Test 3: Counting all workouts...');
    const count = await db.collection('workout_sessions').countDocuments();
    console.log('✅ Total workouts in database:', count);

    // Test 4: Get all athletes
    console.log('\n👥 Test 4: Getting all athletes...');
    const athletes = await db.collection('workout_sessions').aggregate([
      {
        $group: {
          _id: '$athleteName',
          workoutCount: { $sum: 1 },
          lastWorkout: { $max: '$timestamp' }
        }
      }
    ]).toArray();
    console.log('✅ Athletes found:', athletes.length);
    athletes.forEach(athlete => {
      console.log(`   - ${athlete._id}: ${athlete.workoutCount} workouts`);
    });

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await db.collection('workout_sessions').deleteOne({ _id: result.insertedId });
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 All tests passed! MongoDB is working correctly.\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nFull error:', error);
  } finally {
    await closeDB();
    console.log('👋 Connection closed');
  }
}

// Run the test
testMongoDB();
