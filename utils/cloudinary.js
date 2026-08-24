// Cloudinary Upload Utility for TalentTrack
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload base64 image to Cloudinary
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} folder - Cloudinary folder path
 * @param {string} publicId - Optional public ID
 * @returns {Promise<string>} - Cloudinary secure URL
 */
async function uploadImage(base64Data, folder = 'talenttrack/screenshots', publicId = null) {
    try {
        const options = {
            folder,
            resource_type: 'image',
            format: 'jpg',
            quality: 'auto:good',
            access_mode: 'public', // Make publicly accessible
            type: 'upload'
        };

        if (publicId) {
            options.public_id = publicId;
        }

        const result = await cloudinary.uploader.upload(base64Data, options);
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary image upload error:', error);
        throw error;
    }
}

/**
 * Upload base64 PDF to Cloudinary
 * @param {string} base64Data - Base64 encoded PDF data
 * @param {string} folder - Cloudinary folder path
 * @param {string} publicId - Optional public ID
 * @returns {Promise<string>} - Cloudinary secure URL
 */
async function uploadPDF(base64Data, folder = 'talenttrack/reports', publicId = null) {
    try {
        // Ensure the base64 data has the correct PDF mime type
        let pdfData = base64Data;
        if (!pdfData.startsWith('data:application/pdf')) {
            // If it's just base64 without mime type, add it
            if (pdfData.startsWith('data:')) {
                pdfData = pdfData.replace(/^data:[^;]+/, 'data:application/pdf');
            } else {
                pdfData = `data:application/pdf;base64,${pdfData}`;
            }
        }

        const options = {
            folder,
            resource_type: 'raw', // Use 'raw' for PDFs - more reliable than 'auto'
            access_mode: 'public',
            type: 'upload',
            format: 'pdf' // Explicitly set format
        };

        if (publicId) {
            options.public_id = publicId;
        }

        const result = await cloudinary.uploader.upload(pdfData, options);
        console.log('✅ PDF uploaded to Cloudinary:', result.secure_url);
        console.log('📄 PDF resource type:', result.resource_type);
        return result.secure_url;
    } catch (error) {
        console.error('❌ Cloudinary PDF upload error:', error);
        throw error;
    }
}

/**
 * Upload base64 video to Cloudinary
 * @param {string} base64Data - Base64 encoded video data
 * @param {string} folder - Cloudinary folder path
 * @param {string} publicId - Optional public ID
 * @returns {Promise<string>} - Cloudinary secure URL
 */
async function uploadVideo(base64Data, folder = 'talenttrack/videos', publicId = null) {
    try {
        const options = {
            folder,
            resource_type: 'video',
            format: 'webm',
            access_mode: 'public', // Make publicly accessible
            type: 'upload'
        };

        if (publicId) {
            options.public_id = publicId;
        }

        const result = await cloudinary.uploader.upload(base64Data, options);
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary video upload error:', error);
        throw error;
    }
}

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @param {string} resourceType - Type of resource (image, video, raw)
 * @returns {Promise<object>} - Deletion result
 */
async function deleteFile(publicId, resourceType = 'image') {
    try {
        const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
        return result;
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        throw error;
    }
}

module.exports = {
    uploadImage,
    uploadPDF,
    uploadVideo,
    deleteFile,
    cloudinary
};
