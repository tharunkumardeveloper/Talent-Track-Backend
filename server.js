const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const csv = require('csv-parser');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { connectDB, getDB } = require('./db');

// Try to set ffmpeg path
try {
  // Common ffmpeg installation paths
  const possiblePaths = [
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    'ffmpeg' // System PATH
  ];

  for (const ffmpegPath of possiblePaths) {
    if (fs.existsSync(ffmpegPath) || ffmpegPath === 'ffmpeg') {
      ffmpeg.setFfmpegPath(ffmpegPath);
      console.log('FFmpeg path set to:', ffmpegPath);
      break;
    }
  }
} catch (err) {
  console.warn('Could not set ffmpeg path:', err.message);
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Increase payload limit for large PDFs and screenshots
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
const outputsDir = path.join(__dirname, 'outputs');
fs.ensureDirSync(uploadsDir);
fs.ensureDirSync(outputsDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname;
    cb(null, `${timestamp}_${originalName}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Activity to script mapping - using Talent Track py scripts
const activityScripts = {
  'Push-ups': 'pushup_video.py',
  'Pull-ups': 'pullup_video.py',
  'Sit-ups': 'situp_video.py',
  'Vertical Jump': 'verticaljump_video.py',
  'Shuttle Run': 'shuttlerun_video.py',
  'Sit Reach': 'sitreach_video.py',
  'Vertical Broad Jump': 'verticalbroadjump_video.py',
  'Standing Broad Jump': 'verticalbroadjump_video.py'
};

// Live recording scripts
const liveScripts = {
  'Push-ups': 'pushup_live.py',
  'Pull-ups': 'pullup_live.py',
  'Sit-ups': 'situp_live.py',
  'Vertical Jump': 'verticaljump_live.py',
  'Shuttle Run': 'shuttlerun_live.py'
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend is working!',
    availableWorkouts: Object.keys(activityScripts)
  });
});

// Process video endpoint
app.post('/api/process-video', upload.single('video'), async (req, res) => {
  console.log('\n=== New video processing request ===');
  console.log('Time:', new Date().toISOString());

  try {
    const { activityName, mode } = req.body;
    const videoFile = req.file;

    console.log('Activity:', activityName);
    console.log('Mode:', mode);
    console.log('File:', videoFile ? videoFile.originalname : 'No file');

    if (!videoFile) {
      console.error('ERROR: No video file provided');
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!activityName || !activityScripts[activityName]) {
      console.error('ERROR: Invalid activity:', activityName);
      return res.status(400).json({ error: 'Invalid or unsupported activity' });
    }

    const scriptName = activityScripts[activityName];
    // Try Talent Track py scripts folder first, then fall back to scripts folder
    let scriptPath = path.join(__dirname, '..', 'Talent Track py scripts', scriptName);

    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
    }

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: `Script not found: ${scriptName}` });
    }

    const videoPath = videoFile.path;
    const outputId = `${Date.now()}_${activityName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const outputDir = path.join(outputsDir, outputId);

    // Create output directory
    fs.ensureDirSync(outputDir);

    // Execute Python script
    console.log('Executing Python script...');
    const result = await executeScript(scriptPath, videoPath, outputDir, activityName);

    console.log('Processing complete!');
    console.log('Result:', JSON.stringify(result, null, 2));

    // Extract frames from video for browser playback
    if (result.videoFile) {
      try {
        console.log('Extracting frames from video...');
        await extractFramesFromVideo(outputDir, result.videoFile);
        result.hasFrames = true;
      } catch (error) {
        console.warn('Frame extraction failed:', error.message);
        // Try video conversion as fallback
        try {
          await convertVideoToBrowserFormat(outputDir, result.videoFile);
        } catch (convError) {
          console.warn('Video conversion also failed:', convError.message);
        }
      }
    }

    // Clean up uploaded file
    fs.removeSync(videoPath);

    res.json({
      success: true,
      outputId: outputId,
      ...result
    });

  } catch (error) {
    console.error('Error processing video:', error);
    res.status(500).json({ error: 'Failed to process video', details: error.message });
  }
});

// Start live recording endpoint
app.post('/api/start-live-recording', async (req, res) => {
  try {
    const { activityName } = req.body;

    if (!activityName || !liveScripts[activityName]) {
      return res.status(400).json({ error: 'Invalid or unsupported activity for live recording' });
    }

    const scriptName = liveScripts[activityName];
    // Try Talent Track py scripts folder first, then fall back to scripts folder
    let scriptPath = path.join(__dirname, '..', 'Talent Track py scripts', scriptName);

    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.join(__dirname, '..', 'scripts', scriptName);
    }

    if (!fs.existsSync(scriptPath)) {
      return res.status(404).json({ error: `Live script not found: ${scriptName}` });
    }

    const outputId = `live_${Date.now()}_${activityName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const outputDir = path.join(outputsDir, outputId);

    fs.ensureDirSync(outputDir);

    // Execute live script
    const result = await executeLiveScript(scriptPath, outputDir, activityName);

    res.json({
      success: true,
      outputId: outputId,
      ...result
    });

  } catch (error) {
    console.error('Error starting live recording:', error);
    res.status(500).json({ error: 'Failed to start live recording', details: error.message });
  }
});

// Get processed results
app.get('/api/results/:outputId', async (req, res) => {
  try {
    const { outputId } = req.params;
    const outputDir = path.join(outputsDir, outputId);

    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ error: 'Results not found' });
    }

    const results = await getProcessingResults(outputDir);
    res.json(results);

  } catch (error) {
    console.error('Error getting results:', error);
    res.status(500).json({ error: 'Failed to get results', details: error.message });
  }
});

// Serve video frames
app.get('/api/frames/:outputId', (req, res) => {
  const { outputId } = req.params;
  const framesDir = path.join(outputsDir, outputId, 'frames');

  if (fs.existsSync(framesDir)) {
    const frames = fs.readdirSync(framesDir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => `/api/frame/${outputId}/${f}`);

    res.json({ frames, count: frames.length });
  } else {
    res.status(404).json({ error: 'Frames not found' });
  }
});

// Serve individual frame
app.get('/api/frame/:outputId/:filename', (req, res) => {
  const { outputId, filename } = req.params;
  const framePath = path.join(outputsDir, outputId, 'frames', filename);

  if (fs.existsSync(framePath)) {
    res.sendFile(framePath);
  } else {
    res.status(404).send('Frame not found');
  }
});

// Serve processed videos
app.get('/api/video/:outputId/:filename', (req, res) => {
  const { outputId, filename } = req.params;
  const videoPath = path.join(outputsDir, outputId, filename);

  console.log('Video request:', outputId, filename);
  console.log('Video path:', videoPath);
  console.log('File exists:', fs.existsSync(videoPath));

  if (fs.existsSync(videoPath)) {
    console.log('Serving video file');

    // Set headers to prevent caching issues
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.sendFile(videoPath);
  } else {
    console.error('Video file not found!');
    res.status(404).json({ error: 'Video not found' });
  }
});

// Execute Python script for video processing
function executeScript(scriptPath, videoPath, outputDir, activityName) {
  return new Promise((resolve, reject) => {
    // Modify the script to accept command line arguments
    const modifiedScript = createModifiedScript(scriptPath, videoPath, outputDir);
    const tempScriptPath = path.join(outputDir, 'temp_script.py');

    fs.writeFileSync(tempScriptPath, modifiedScript);

    const pythonProcess = spawn('python', [tempScriptPath], {
      cwd: outputDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      // Clean up temp script
      fs.removeSync(tempScriptPath);

      if (code !== 0) {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const results = await getProcessingResults(outputDir);
        resolve(results);
      } catch (error) {
        reject(error);
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

// Execute live recording script
function executeLiveScript(scriptPath, outputDir, activityName) {
  return new Promise((resolve, reject) => {
    const modifiedScript = createModifiedLiveScript(scriptPath, outputDir);
    const tempScriptPath = path.join(outputDir, 'temp_live_script.py');

    fs.writeFileSync(tempScriptPath, modifiedScript);

    // For live scripts, we'll simulate the execution since they require camera access
    // In a real implementation, you'd handle this differently
    setTimeout(async () => {
      try {
        // Create mock results for live recording
        const mockResults = createMockLiveResults(activityName, outputDir);
        resolve(mockResults);
      } catch (error) {
        reject(error);
      }
    }, 3000); // Simulate 3 second processing time
  });
}

// Create modified script that doesn't require GUI file selection
function createModifiedScript(originalScriptPath, videoPath, outputDir) {
  let script = fs.readFileSync(originalScriptPath, 'utf8');

  // Remove tkinter imports and file dialog
  script = script.replace(/from tkinter import Tk, filedialog\n/g, '');
  script = script.replace(/Tk\(\)\.withdraw\(\)\n/g, '');

  // Replace file selection with direct path
  // Use forward slashes for Python (works on Windows too)
  const videoPathForPython = videoPath.replace(/\\/g, '/');

  // Remove the file dialog lines
  // First, remove the entire filedialog line (including nested brackets)
  const fileDialogPattern = /video_path = filedialog\.askopenfilename\([^)]*\[[^\]]*\][^)]*\)/g;
  script = script.replace(fileDialogPattern, `video_path = r"${videoPathForPython}"`);

  // Also handle simpler patterns without filetypes
  script = script.replace(/video_path = filedialog\.askopenfilename\(\)/g, `video_path = r"${videoPathForPython}"`);

  // Remove the exit conditions
  script = script.replace(/if not video_path:\s*\n\s*print\([^)]*\)\s*\n\s*exit\(\)/g, '');
  script = script.replace(/if not video_path:\s*\n\s*exit\(\)/g, '');

  // Modify output paths to use our output directory
  const outputDirForPython = outputDir.replace(/\\/g, '/');
  const baseFilename = path.basename(outputDir);

  script = script.replace(
    /filename = os\.path\.splitext\(os\.path\.basename\(video_path\)\)\[0\]/g,
    `filename = "${baseFilename}"`
  );
  script = script.replace(/output_folder = filename/g, `output_folder = r"${outputDirForPython}"`);

  // Ensure output directory exists
  script = `import os\nimport sys\n${script}`;
  script = script.replace(
    /os\.makedirs\(output_folder, exist_ok=True\)/g,
    `os.makedirs(r"${outputDirForPython}", exist_ok=True)`
  );

  // Remove cv2.imshow and waitKey calls to run headless
  // Comment out entire lines with cv2.imshow
  script = script.replace(/^(\s*)cv2\.imshow\([^)]*\)/gm, '$1pass  # cv2.imshow removed');

  // Replace cv2.waitKey expressions properly
  script = script.replace(/cv2\.waitKey\(int\(1000\/fps\)\)/g, '1');
  script = script.replace(/cv2\.waitKey\([^)]*\)/g, '1');

  // Comment out cv2.destroyAllWindows
  script = script.replace(/^(\s*)cv2\.destroyAllWindows\(\)/gm, '$1pass  # cv2.destroyAllWindows removed');

  return script;
}

// Create modified live script
function createModifiedLiveScript(originalScriptPath, outputDir) {
  let script = fs.readFileSync(originalScriptPath, 'utf8');

  // Modify for headless execution and output to our directory
  const outputDirForPython = outputDir.replace(/\\/g, '/');
  script = script.replace(/output_folder = filename/g, `output_folder = r"${outputDirForPython}"`);
  script = script.replace(/filename = "camera_feed"/g, `filename = "${path.basename(outputDir)}"`);

  // Ensure output directory exists
  script = `import os\nimport sys\n${script}`;
  script = script.replace(
    /os\.makedirs\(output_folder, exist_ok=True\)/g,
    `os.makedirs(r"${outputDirForPython}", exist_ok=True)`
  );

  // Remove cv2.imshow and waitKey calls to run headless
  // Comment out entire lines with cv2.imshow
  script = script.replace(/^(\s*)cv2\.imshow\([^)]*\)/gm, '$1pass  # cv2.imshow removed');

  // Replace cv2.waitKey expressions properly
  script = script.replace(/cv2\.waitKey\(1\)/g, '1');

  // Comment out cv2.destroyAllWindows
  script = script.replace(/^(\s*)cv2\.destroyAllWindows\(\)/gm, '$1pass  # cv2.destroyAllWindows removed');

  // Add automatic termination after some time (30 seconds)
  script = script.replace(/while True:/g, `
frame_count = 0
max_frames = int(fps * 30)  # 30 seconds max
while frame_count < max_frames:`);

  script = script.replace(/frame_idx \+= 1/g, `
frame_idx += 1
frame_count += 1`);

  return script;
}

// Get processing results from output directory
async function getProcessingResults(outputDir) {
  const files = fs.readdirSync(outputDir);
  console.log('Files in output directory:', files);

  // Find CSV file (look for various naming patterns)
  const csvFile = files.find(file =>
    file.endsWith('.csv') &&
    !file.includes('temp') &&
    !file.includes('vertical_jump_log.csv') // Exclude the old log file
  ) || files.find(file => file.endsWith('.csv'));

  const videoFile = files.find(file => file.endsWith('_annotated.mp4'));

  console.log('Found CSV file:', csvFile);
  console.log('Found video file:', videoFile);

  let csvData = null;
  if (csvFile) {
    try {
      csvData = await readCSVFile(path.join(outputDir, csvFile));
      console.log('CSV data rows:', csvData ? csvData.length : 0);
    } catch (error) {
      console.error('Error reading CSV file:', error);
      csvData = [];
    }
  }

  return {
    csvData: csvData,
    videoFile: videoFile,
    outputPath: outputDir,
    files: files
  };
}

// Read CSV file and return parsed data
function readCSVFile(csvPath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// Extract frames from video for browser playback
async function extractFramesFromVideo(outputDir, videoFile) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(outputDir, videoFile);
    const framesDir = path.join(outputDir, 'frames');

    // Create frames directory
    fs.ensureDirSync(framesDir);

    console.log('Extracting frames at 10 FPS...');

    ffmpeg(inputPath)
      .outputOptions([
        '-vf fps=10', // Extract 10 frames per second
        '-q:v 2'      // High quality
      ])
      .output(path.join(framesDir, 'frame_%04d.jpg'))
      .on('start', (cmd) => {
        console.log('FFmpeg command:', cmd);
      })
      .on('progress', (progress) => {
        if (progress.frames) {
          console.log('Extracted frames:', progress.frames);
        }
      })
      .on('end', () => {
        const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));
        console.log(`✅ Extracted ${frames.length} frames`);
        resolve();
      })
      .on('error', (err) => {
        console.error('❌ Frame extraction error:', err.message);
        reject(err);
      })
      .run();
  });
}

// Convert video to browser-compatible format
async function convertVideoToBrowserFormat(outputDir, videoFile) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(outputDir, videoFile);
    const outputPath = path.join(outputDir, videoFile.replace('.mp4', '_web.mp4'));

    console.log('Converting video to browser-compatible format...');
    console.log('Input:', inputPath);
    console.log('Output:', outputPath);

    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset fast',
        '-crf 23',
        '-movflags +faststart',
        '-pix_fmt yuv420p'
      ])
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log('Converting:', Math.round(progress.percent) + '%');
        }
      })
      .on('end', () => {
        console.log('✅ Video converted successfully!');
        // Replace original with converted version
        try {
          fs.removeSync(inputPath);
          fs.renameSync(outputPath, inputPath);
          console.log('✅ Original video replaced with converted version');
          resolve();
        } catch (err) {
          console.error('Error replacing file:', err);
          reject(err);
        }
      })
      .on('error', (err) => {
        console.error('❌ FFmpeg conversion error:', err.message);
        reject(err);
      })
      .save(outputPath);
  });
}

// Create mock results for live recording demo
function createMockLiveResults(activityName, outputDir) {
  const mockData = {
    'Push-ups': [
      { count: 1, down_time: 2.1, up_time: 3.2, dip_duration_sec: 1.1, min_elbow_angle: 68, correct: true },
      { count: 2, down_time: 4.5, up_time: 5.8, dip_duration_sec: 1.3, min_elbow_angle: 72, correct: true },
      { count: 3, down_time: 7.2, up_time: 8.1, dip_duration_sec: 0.9, min_elbow_angle: 85, correct: false }
    ],
    'Pull-ups': [
      { count: 1, up_time: 2.0, down_time: 4.5, dip_duration_sec: 2.5, min_elbow_angle: 165 },
      { count: 2, up_time: 6.0, down_time: 9.2, dip_duration_sec: 3.2, min_elbow_angle: 170 }
    ]
  };

  const csvData = mockData[activityName] || [];

  // Create mock CSV file
  if (csvData.length > 0) {
    const csvPath = path.join(outputDir, 'live_results.csv');
    const csvContent = Object.keys(csvData[0]).join(',') + '\n' +
      csvData.map(row => Object.values(row).join(',')).join('\n');
    fs.writeFileSync(csvPath, csvContent);
  }

  return {
    csvData: csvData,
    videoFile: null, // Live recording doesn't produce video file immediately
    outputPath: outputDir,
    files: ['live_results.csv']
  };
}

// ============================================
// MONGODB WORKOUT STORAGE ROUTES
// ============================================
const sessionsRouter = require('./routes/sessions');
const usersRouter = require('./routes/users');
const authRouter = require('./routes/auth');
const verificationRouter = require('./routes/verification');
const connectionsRouter = require('./routes/connections');
const dbUtilsRouter = require('./db-utils');

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'TalentTrack Backend API',
    status: 'running',
    endpoints: {
      health: '/api/health',
      sessions: '/api/sessions/*',
      users: '/api/users/*',
      database: '/api/db/*'
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Server is running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api', verificationRouter);
app.use('/api', connectionsRouter);
app.use('/api/db', dbUtilsRouter);

// Legacy endpoint for backward compatibility
app.post('/api/save-workout', async (req, res) => {
  // Redirect to new endpoint
  req.url = '/api/sessions/add';
  sessionsRouter(req, res);
});

// Connect to MongoDB and start server
async function startServer() {
  try {
    // Connect to MongoDB first
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ MongoDB connected successfully');

    // Then start the server
    app.listen(PORT, () => {
      console.log(`✅ Workout processor server running on port ${PORT}`);
      console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    console.log('⚠️  Starting server without database connection...');
    
    // Start server anyway (will use localStorage fallback)
    app.listen(PORT, () => {
      console.log(`⚠️  Server running on port ${PORT} (MongoDB unavailable)`);
    });
  }
}

// Start the server
startServer();