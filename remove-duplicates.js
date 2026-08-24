/**
 * Remove Duplicate Workouts Script
 * Removes duplicate workout entries from MongoDB
 * Keeps the most recent workout when duplicates are found
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function removeDuplicates() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('talenttrack');
    const workoutsCollection = db.collection('workout_sessions');
    
    // Find all workouts
    const allWorkouts = await workoutsCollection.find({}).toArray();
    console.log(`📊 Total workouts found: ${allWorkouts.length}`);
    
    // Group workouts by athlete name, activity, and timestamp (within 1 minute)
    const duplicateGroups = new Map();
    
    allWorkouts.forEach(workout => {
      // Skip workouts with invalid timestamps
      if (!workout.timestamp) {
        console.log(`⚠️  Skipping workout ${workout._id} - no timestamp`);
        return;
      }
      
      // Create a key based on athlete, activity, and rounded timestamp
      const timestamp = new Date(workout.timestamp);
      if (isNaN(timestamp.getTime())) {
        console.log(`⚠️  Skipping workout ${workout._id} - invalid timestamp: ${workout.timestamp}`);
        return;
      }
      
      const roundedTime = new Date(Math.floor(timestamp.getTime() / 60000) * 60000); // Round to minute
      const key = `${workout.athleteName}_${workout.activityName}_${roundedTime.toISOString()}`;
      
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key).push(workout);
    });
    
    // Find and remove duplicates
    let duplicatesRemoved = 0;
    let repImagesRemoved = 0;
    
    for (const [key, workouts] of duplicateGroups.entries()) {
      if (workouts.length > 1) {
        console.log(`\n🔍 Found ${workouts.length} duplicates for: ${key}`);
        
        // Sort by timestamp (most recent first)
        workouts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Keep the first (most recent), delete the rest
        const toKeep = workouts[0];
        const toDelete = workouts.slice(1);
        
        console.log(`   ✅ Keeping workout: ${toKeep._id} (${new Date(toKeep.timestamp).toLocaleString()})`);
        
        for (const workout of toDelete) {
          console.log(`   🗑️  Deleting workout: ${workout._id} (${new Date(workout.timestamp).toLocaleString()})`);
          
          // Delete associated rep images
          const repResult = await db.collection('rep_images').deleteMany({
            sessionId: workout._id.toString()
          });
          repImagesRemoved += repResult.deletedCount;
          
          // Delete the workout
          await workoutsCollection.deleteOne({ _id: workout._id });
          duplicatesRemoved++;
        }
      }
    }
    
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   🗑️  Removed ${duplicatesRemoved} duplicate workouts`);
    console.log(`   🗑️  Removed ${repImagesRemoved} associated rep images`);
    console.log(`   📊 Remaining workouts: ${allWorkouts.length - duplicatesRemoved}`);
    
  } catch (error) {
    console.error('❌ Error removing duplicates:', error);
  } finally {
    await client.close();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
removeDuplicates()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
