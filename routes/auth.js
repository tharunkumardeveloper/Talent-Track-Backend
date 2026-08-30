const express = require("express");
const router = express.Router();
const { getDB } = require("../db");
const { uploadImage } = require("../utils/cloudinary");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const bcrypt = require("bcryptjs");

/**
 * Cost factor for password hashing.
 *
 * 10 is roughly 100ms on Render's free tier - slow enough to make offline
 * guessing expensive, fast enough that a login does not feel stalled. Raising
 * it later is safe: the cost is stored inside each hash, so old hashes keep
 * verifying and only new ones get the higher factor.
 */
const BCRYPT_ROUNDS = 10;

/** bcrypt hashes all start with $2a$, $2b$ or $2y$ followed by the cost. */
function isHashed(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

/**
 * Checks a password, upgrading it from plaintext on the way through.
 *
 * Accounts predating hashing hold the password as typed. Rejecting them would
 * lock out every existing user, and rehashing them all in one pass is not
 * possible - the plaintext is the only thing that can produce the hash, and it
 * is only in hand at the moment someone signs in. So the first correct login
 * after this deploy silently replaces the stored value with a hash, and no
 * account is ever locked out or left in plaintext once its owner returns.
 */
async function verifyPassword(db, user, candidate) {
  if (isHashed(user.password)) {
    return bcrypt.compare(candidate, user.password);
  }

  if (user.password !== candidate) return false;

  const hash = await bcrypt.hash(candidate, BCRYPT_ROUNDS);
  await db.collection("users").updateOne(
    { userId: user.userId },
    { $set: { password: hash, updatedAt: new Date() } }
  );
  console.log('🔒 Upgraded stored password to a hash:', user.userId);
  return true;
}

/**
 * Google token verifier.
 *
 * The audience is the Web client ID: Google mints ID tokens for that client
 * even when the sign-in happened natively on Android, so it is the value the
 * token must be checked against regardless of platform.
 */
const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

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

    const newUser = {
      userId,
      name,
      email,
      // Hashed, never stored as typed. People reuse passwords across sites, so
      // a readable copy here is a liability for accounts that have nothing to
      // do with this app.
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
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

    // A Google-created account has no password, so there is nothing to check
    // against - and comparing would otherwise let an empty value through.
    if (!user.password) {
      return res.status(401).json({
        success: false,
        error: 'This account signs in with Google'
      });
    }

    if (!(await verifyPassword(db, user, password))) {
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

// POST /api/auth/google - Sign in or sign up with a Google ID token
//
// The token is verified here rather than trusted from the client. That is the
// whole point of this endpoint: a client can read a JWT's contents but cannot
// meaningfully verify them, so anything decoded on a device is only as
// trustworthy as the device. Verifying against Google's public keys proves the
// token was issued by Google, for this app, and has not expired.
//
// It also removes the password workaround. The app previously represented a
// Google account as an email-and-password pair derived from the account id,
// because that was the only shape this API accepted.
router.post("/google", async (req, res) => {
  try {
    if (!googleClient) {
      return res.status(503).json({
        success: false,
        error: 'Google sign-in is not configured on the server'
      });
    }

    const db = getDB();
    const { idToken, role } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'idToken is required'
      });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (err) {
      console.error('❌ Google token verification failed:', err.message);
      return res.status(401).json({
        success: false,
        error: 'Google sign-in could not be verified'
      });
    }

    // An unverified address could be one the holder does not actually own,
    // which would let them claim an existing account by signing up with it.
    if (!payload || !payload.email || payload.email_verified === false) {
      return res.status(401).json({
        success: false,
        error: 'Google account has no verified email address'
      });
    }

    const email = payload.email;
    const googleId = payload.sub;

    let user = await db.collection("users").findOne({ email });

    if (user) {
      // Link the Google identity on first use, so a later change of email
      // address on either side can still be reconciled.
      if (!user.googleId) {
        await db.collection("users").updateOne(
          { email },
          { $set: { googleId, updatedAt: new Date() } }
        );
      }
      console.log('✅ Google sign-in:', user.userId);
    } else {
      const assignedRole = role || 'ATHLETE';
      const userId = `${assignedRole.toLowerCase()}_${crypto.randomBytes(8).toString('hex')}`;

      user = {
        userId,
        name: payload.name || email.split('@')[0],
        email,
        // No password field at all. This account is proven by Google, and
        // inventing a password for it would create a second, weaker way in.
        googleId,
        phone: '',
        role: assignedRole,
        profilePic: payload.picture || '',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.collection("users").insertOne(user);
      console.log('✅ Google account created:', userId);
    }

    res.status(200).json({
      success: true,
      message: 'Google sign-in successful',
      user: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        profilePic: user.profilePic || ''
      }
    });

  } catch (err) {
    console.error('❌ Google sign-in error:', err);
    res.status(500).json({
      success: false,
      error: 'Google sign-in failed',
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
