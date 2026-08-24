const express = require("express");
const router = express.Router();
const { getDB } = require("../db");
const { uploadImage } = require("../utils/cloudinary");
const crypto = require("crypto");

// POST /api/auth/signup - Create new user account
router.post("/signup", async (req, res) => {
  try {
    const db = getDB();
    const { name, email, password, phone, role, profilePic } = req.body;

    console.log('📝 Signup request:', { name, email, role });

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, password, and role are required'
      });
    }

    // Check if user already exists
    const existingUser = await db.collection("users").findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Generate unique userId
    const userId = `${role.toLowerCase()}_${crypto.randomBytes(8).toString('hex')}`;

    // Upload profile picture to Cloudinary if provided
    let profilePicUrl = profilePic || '';
    if (profilePic && profilePic.startsWith('data:image')) {
      console.log('📸 Uploading profile picture to Cloudinary...');
      try {
        const publicId = `${userId}_profile_${Date.now()}`;
        profilePicUrl = await uploadImage(profilePic, 'talenttrack/profiles', publicId);
        console.log('✅ Profile picture uploaded:', profilePicUrl);
      } catch (error) {
        console.warn('⚠️ Profile picture upload failed:', error.message);
        profilePicUrl = profilePic; // Keep base64 as fallback
      }
    }

    // Create user profile (store password as plain text for now - in production use bcrypt)
    const newUser = {
      userId,
      name,
      email,
      password, // In production, hash this with bcrypt
      phone: phone || '',
      role,
      profilePic: profilePicUrl,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection("users").insertOne(newUser);

    console.log('✅ User created:', userId);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        userId,
        name,
        email,
        phone,
        role,
        profilePic: profilePicUrl
      }
    });

  } catch (err) {
    console.error('❌ Error creating account:', err);
    res.status(500).json({
      success: false,
      error: 'Error creating account',
      details: err.message
    });
  }
});

// POST /api/auth/login - Login user
router.post("/login", async (req, res) => {
  try {
    const db = getDB();
    const { email, password } = req.body;

    console.log('🔐 Login request:', email);

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user by email
    const user = await db.collection("users").findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please sign up first.'
      });
    }

    // Check password (in production, use bcrypt.compare)
    if (user.password !== password) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password'
      });
    }

    console.log('✅ User logged in:', user.userId);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        profilePic: user.profilePic
      }
    });

  } catch (err) {
    console.error('❌ Error logging in:', err);
    res.status(500).json({
      success: false,
      error: 'Error logging in',
      details: err.message
    });
  }
});

// POST /api/auth/check-email - Check if email exists
router.post("/check-email", async (req, res) => {
  try {
    const db = getDB();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const user = await db.collection("users").findOne({ email });

    res.status(200).json({
      success: true,
      exists: !!user,
      user: user ? {
        name: user.name,
        role: user.role
      } : null
    });

  } catch (err) {
    console.error('❌ Error checking email:', err);
    res.status(500).json({
      success: false,
      error: 'Error checking email',
      details: err.message
    });
  }
});

module.exports = router;
