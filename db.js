const { MongoClient } = require("mongodb");
require('dotenv').config();

// MongoDB connection URI - use environment variable or default
const uri = process.env.MONGODB_URI || "mongodb+srv://<username>:<password>@cluster0.rzbfab5.mongodb.net/?appName=Cluster0";

const client = new MongoClient(uri);

let db;

async function connectDB() {
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
