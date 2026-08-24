// Migration Script: Fix Old PDF URLs in MongoDB
// Converts /image/upload/ to /raw/upload/ for all PDF URLs

const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function migratePDFUrls() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('talenttrack');
    const collection = db.collection('workout_sessions');

    // Find all workouts with PDF URLs that have /image/upload/
    const workoutsToFix = await collection.find({
      pdfUrl: { $regex: '/image/upload/.*\\.pdf' }
    }).toArray();

    console.log(`\n📊 Found ${workoutsToFix.length} workouts with incorrect PDF URLs`);

    if (workoutsToFix.length === 0) {
      console.log('✅ No workouts need fixing!');
      return;
    }

    // Update each workout
    let updatedCount = 0;
    for (const workout of workoutsToFix) {
      const oldUrl = workout.pdfUrl;
      const newUrl = oldUrl.replace('/image/upload/', '/raw/upload/');

      console.log(`\n🔧 Fixing workout: ${workout.athleteName} - ${workout.activityName}`);
      console.log(`   Old: ${oldUrl.substring(0, 80)}...`);
      console.log(`   New: ${newUrl.substring(0, 80)}...`);

      const result = await collection.updateOne(
        { _id: workout._id },
        { $set: { pdfUrl: newUrl } }
      );

      if (result.modifiedCount > 0) {
        updatedCount++;
        console.log(`   ✅ Updated successfully`);
      } else {
        console.log(`   ⚠️ Update failed`);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   Total workouts found: ${workoutsToFix.length}`);
    console.log(`   Successfully updated: ${updatedCount}`);

  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await client.close();
    console.log('\n👋 Connection closed');
  }
}

// Run migration
console.log('🚀 Starting PDF URL migration...\n');
migratePDFUrls();
