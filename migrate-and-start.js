// Automated setup script for Render deployment
// Runs DB setup, migration, then starts the server

const { execSync } = require("child_process");

console.log('🚀 TalentTrack Backend - Automated Setup\n');

try {
  console.log('📋 Step 1: Setting up database collections & indexes...');
  execSync("node mongodb-schema.js", { stdio: "inherit" });
  console.log('✅ Database setup complete\n');

  console.log('📋 Step 2: Migrating existing data...');
  execSync("node migrate-data.js", { stdio: "inherit" });
  console.log('✅ Data migration complete\n');

  console.log('📋 Step 3: Starting server...');
  execSync("node server.js", { stdio: "inherit" });

} catch (err) {
  console.error('❌ Error during setup or server start:', err.message);
  process.exit(1);
}
