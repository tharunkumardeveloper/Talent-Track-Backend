const { MongoClient } = require("mongodb");
require('dotenv').config();

// MongoDB connection URI - use environment variable or default
// No fallback: a missing MONGODB_URI should fail loudly at boot rather than
// silently attempting to connect to a cluster baked into the source.
const uri = process.env.MONGODB_URI;

if (!uri) {
  // Fail with something actionable. `new MongoClient(undefined)` throws at
  // module load with an opaque message, before server.js can catch it and fall
  // back to running without a database.
  console.error('MONGODB_URI is not set.');
  console.error('Set it in the environment (Render dashboard) or a local .env file.');
  console.error('See .env.example for the expected format.');
}

const client = uri ? new MongoClient(uri) : null;

let db;

async function connectDB() {
  if (!client) throw new Error('MONGODB_URI is not configured');
  try {
    await client.connect();
    db = client.db("talenttrack");
    console.log("✅ Connected to MongoDB Atlas");
    
    // Create indexes for better query performance (production-safe)
    try {
      await db.collection("workout_sessions").createIndex(
        { athleteName: 1, timestamp: -1 },
        { background: true }
      );
      await db.collection("rep_images").createIndex(
        { sessionId: 1 },
        { background: true }
      );
      await db.collection("rep_images").createIndex(
        { sessionId: 1, repNumber: 1 },
        { unique: true, background: true }
      );
      console.log("✅ Database indexes created");
    } catch (indexErr) {
      // Ignore "already exists" errors
      if (!indexErr.message.includes('already exists')) {
        console.warn("⚠️ Index creation warning:", indexErr.message);
      } else {
        console.log("✅ Database indexes already exist");
      }
    }
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    console.error("💡 Please update your MongoDB credentials in server/.env");
    throw err;
  }
}

function getDB() {
  if (!db) throw new Error("Database not connected yet");
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

module.exports = { connectDB, getDB, closeDB };
