// Script to make existing Cloudinary PDFs publicly accessible
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function fixCloudinaryAccess() {
  try {
    console.log('🔧 Starting Cloudinary access fix...\n');

    // Get all resources in the talenttrack/reports folder
    console.log('📂 Fetching PDFs from talenttrack/reports...');
    const result = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'raw',
      prefix: 'talenttrack/reports',
      max_results: 500
    });

    console.log(`📊 Found ${result.resources.length} PDF files\n`);

    if (result.resources.length === 0) {
      console.log('✅ No PDFs found to update');
      return;
    }

    // Update each PDF to be publicly accessible
    let updatedCount = 0;
    for (const resource of result.resources) {
      try {
        console.log(`🔧 Updating: ${resource.public_id}`);
        console.log(`   Current access: ${resource.access_mode || 'not set'}`);

        // Update the resource to be public
        await cloudinary.uploader.explicit(resource.public_id, {
          type: 'upload',
          resource_type: 'raw',
          access_mode: 'public'
        });

        console.log(`   ✅ Updated to public access`);
        updatedCount++;
      } catch (error) {
        console.error(`   ❌ Failed to update ${resource.public_id}:`, error.message);
      }
      console.log('');
    }

    console.log(`\n✅ Update complete!`);
    console.log(`   Total PDFs: ${result.resources.length}`);
    console.log(`   Successfully updated: ${updatedCount}`);
    console.log(`   Failed: ${result.resources.length - updatedCount}`);

    // Also update screenshots
    console.log('\n📂 Fetching screenshots from talenttrack/screenshots...');
    const screenshotsResult = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'image',
      prefix: 'talenttrack/screenshots',
      max_results: 500
    });

    console.log(`📊 Found ${screenshotsResult.resources.length} screenshot files\n`);

    let screenshotsUpdated = 0;
    for (const resource of screenshotsResult.resources) {
      try {
        console.log(`🔧 Updating screenshot: ${resource.public_id}`);
        
        await cloudinary.uploader.explicit(resource.public_id, {
          type: 'upload',
          resource_type: 'image',
          access_mode: 'public'
        });

        console.log(`   ✅ Updated to public access`);
        screenshotsUpdated++;
      } catch (error) {
        console.error(`   ❌ Failed:`, error.message);
      }
    }

    console.log(`\n✅ Screenshots update complete!`);
    console.log(`   Total screenshots: ${screenshotsResult.resources.length}`);
    console.log(`   Successfully updated: ${screenshotsUpdated}`);

    // Also update videos
    console.log('\n📂 Fetching videos from talenttrack/videos...');
    const videosResult = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'video',
      prefix: 'talenttrack/videos',
      max_results: 500
    });

    console.log(`📊 Found ${videosResult.resources.length} video files\n`);

    let videosUpdated = 0;
    for (const resource of videosResult.resources) {
      try {
        console.log(`🔧 Updating video: ${resource.public_id}`);
        
        await cloudinary.uploader.explicit(resource.public_id, {
          type: 'upload',
          resource_type: 'video',
          access_mode: 'public'
        });

        console.log(`   ✅ Updated to public access`);
        videosUpdated++;
      } catch (error) {
        console.error(`   ❌ Failed:`, error.message);
      }
    }

    console.log(`\n✅ Videos update complete!`);
    console.log(`   Total videos: ${videosResult.resources.length}`);
    console.log(`   Successfully updated: ${videosUpdated}`);

    console.log('\n🎉 All Cloudinary resources updated to public access!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the fix
console.log('🚀 Cloudinary Access Fix Tool\n');
fixCloudinaryAccess();
