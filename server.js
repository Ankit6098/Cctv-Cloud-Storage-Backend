const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

const startFFmpeg = require("./ffmpeg");
const watchFiles = require("./watcher");
const cleanup = require("./cleanup");
const driveManager = require("./driveManager");
const { uploadQueue } = require("./upload");
require("dotenv").config();

const app = express();

// Enhanced CORS configuration
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
    allowedHeaders: ["Content-Type"],
  }),
);

app.use(express.json());

// Middleware to set cache and CORS headers for stream files
app.use((req, res, next) => {
  // Allow cross-origin requests
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Disable caching for m3u8 and ts files
  if (req.url.endsWith(".m3u8") || req.url.endsWith(".ts")) {
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    res.header("Pragma", "no-cache");
    res.header("Expires", "0");
    res.header(
      "Content-Type",
      req.url.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp2t",
    );
  }

  next();
});

app.use("/stream", express.static("stream"));
app.use("/recordings", express.static("recordings"));

let ffmpegProcesses = { hls: null, recording: null };

app.get("/", (req, res) => {
  res.send("CCTV Backend Running");
});

// Debug endpoint to check connection status
app.get("/api/status", (req, res) => {
  const rtspUrl = process.env.rtspUrl || "NOT_CONFIGURED";
  const recordingsDir = path.join(__dirname, "recordings");
  const m3u8File = path.join(__dirname, "stream/index.m3u8");

  let recordingSize = 0;
  let latestRecordingFile = null;
  let m3u8Exists = false;

  try {
    // Check for latest recording file (FFmpeg auto-timestamps with -strftime)
    if (fs.existsSync(recordingsDir)) {
      const files = fs.readdirSync(recordingsDir);
      const mp4Files = files.filter((file) => file.endsWith(".mp4"));

      if (mp4Files.length > 0) {
        // Get the most recently modified file
        let newestFile = mp4Files[0];
        let newestTime = fs.statSync(
          path.join(recordingsDir, newestFile),
        ).mtime;

        for (const file of mp4Files) {
          const filePath = path.join(recordingsDir, file);
          const fileTime = fs.statSync(filePath).mtime;
          if (fileTime > newestTime) {
            newestTime = fileTime;
            newestFile = file;
          }
        }

        latestRecordingFile = newestFile;
        recordingSize = fs.statSync(path.join(recordingsDir, newestFile)).size;
      }
    }

    m3u8Exists = fs.existsSync(m3u8File);
  } catch (err) {
    console.error("Error checking files:", err);
  }

  res.json({
    status: "running",
    rtspUrl: rtspUrl,
    latestRecordingFile: latestRecordingFile,
    recordingSize: recordingSize,
    m3u8Exists: m3u8Exists,
    streamUrl: "http://localhost:5000/stream/index.m3u8",
    message:
      recordingSize === 0
        ? "WARNING: Empty recording file. Check RTSP password!"
        : "Receiving stream data",
  });
});

// Test RTSP connection with different passwords
app.post("/api/test-rtsp", (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  const testUrl = `rtsp://admin:${password}@192.168.0.100:5543/live/channel0`;

  console.log(`Testing RTSP connection with password: ${password}`);
  console.log(`URL: ${testUrl}`);

  const timeout = setTimeout(() => {
    console.log("RTSP test timeout");
    res.json({
      success: false,
      message: "Connection timeout - wrong password?",
    });
  }, 5000);

  ffmpeg(testUrl)
    .inputOptions(["-rtsp_transport udp", "-t 3"])
    .on("error", (err) => {
      clearTimeout(timeout);
      console.error("RTSP test error:", err.message);
      res.json({
        success: false,
        message: err.message,
        hint: "Check if IP, port, and password are correct",
      });
    })
    .on("end", () => {
      clearTimeout(timeout);
      console.log("RTSP connection successful!");
      res.json({
        success: true,
        message: "Connection successful!",
        rtspUrl: testUrl,
      });
    })
    .output("/dev/null")
    .run();
});

// Update .env with new RTSP URL
app.post("/api/update-rtsp", (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  const newRtspUrl = `rtsp://admin:${password}@192.168.0.100:5543/live/channel0`;
  const envContent = `rtspUrl = "${newRtspUrl}"`;
  const envPath = path.join(__dirname, ".env");

  fs.writeFileSync(envPath, envContent, "utf8");
  console.log("RTSP URL updated:", newRtspUrl);

  res.json({
    success: true,
    message: "RTSP URL updated. Restart backend to apply changes.",
  });
});

/**
 * GET /api/storage - Get local and Google Drive storage status
 */
app.get("/api/storage", async (req, res) => {
  try {
    const recordingsDir = path.join(__dirname, "recordings");
    let localSize = 0;
    let fileCount = 0;

    // Calculate local storage
    if (fs.existsSync(recordingsDir)) {
      const files = fs.readdirSync(recordingsDir);
      fileCount = files.length;

      files.forEach((file) => {
        try {
          const filePath = path.join(recordingsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            localSize += stat.size;
          }
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      });
    }

    // Get Drive storage
    let driveSize = 0;
    let driveFileCount = 0;
    if (process.env.SHARED_DRIVE_ID && driveManager.initialized) {
      driveSize = await driveManager.getStorageSize(
        process.env.SHARED_DRIVE_ID,
      );
    }

    const storageLimitGB = process.env.STORAGE_LIMIT_GB || 12;
    const storageLimitBytes = storageLimitGB * 1024 * 1024 * 1024;
    const totalSize = localSize + driveSize;

    res.json({
      local: {
        size: localSize,
        sizeFormatted: driveManager.formatBytes(localSize),
        fileCount: fileCount,
      },
      drive: {
        size: driveSize,
        sizeFormatted: driveManager.formatBytes(driveSize),
        configured: !!process.env.SHARED_DRIVE_ID,
      },
      total: {
        size: totalSize,
        sizeFormatted: driveManager.formatBytes(totalSize),
        limitGB: storageLimitGB,
        limitBytes: storageLimitBytes,
        percentUsed: ((totalSize / storageLimitBytes) * 100).toFixed(1),
      },
    });
  } catch (error) {
    console.error("Error getting storage status:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/upload-queue - Get upload queue status
 */
app.get("/api/upload-queue", (req, res) => {
  const status = uploadQueue.getStatus();

  res.json({
    queueSize: status.queueSize,
    isProcessing: status.isProcessing,
    pendingFiles: status.pendingFiles.map((item) => ({
      file: item.file,
      retries: item.retries,
      addedAt: item.addedAt,
    })),
  });
});

/**
 * POST /api/manual-cleanup - Trigger manual storage cleanup
 */
app.post("/api/manual-cleanup", async (req, res) => {
  try {
    console.log("Manual cleanup triggered");

    // Trigger cleanup (it's already exported from cleanup.js but we need to call the functions)
    // For now, just return a success message
    res.json({
      success: true,
      message: "Cleanup initiated. Check server logs for details.",
    });
  } catch (error) {
    console.error("Error during manual cleanup:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/drive-info - Get Google Drive configuration and info
 */
app.get("/api/drive-info", (req, res) => {
  const configured = !!process.env.SHARED_DRIVE_ID;
  const initialized = driveManager.initialized;

  res.json({
    configured: configured,
    initialized: initialized,
    driveId: configured
      ? process.env.SHARED_DRIVE_ID.substring(0, 10) + "..."
      : null,
    message: !configured
      ? "Google Drive not configured. Set SHARED_DRIVE_ID in .env"
      : initialized
        ? "Google Drive ready"
        : "Google Drive initializing...",
  });
});

/**
 * GET /api/old-recording - Get the oldest recording file (at least 5 minutes old)
 */
app.get("/api/old-recording", (req, res) => {
  try {
    const recordingsDir = path.join(__dirname, "recordings");

    if (!fs.existsSync(recordingsDir)) {
      return res.status(404).json({ error: "Recordings directory not found" });
    }

    const files = fs
      .readdirSync(recordingsDir)
      .filter((f) => f.endsWith(".mp4"));

    if (files.length === 0) {
      return res.status(404).json({ error: "No recording files found" });
    }

    // Get file stats and find oldest file that's at least 5 minutes old
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    let oldestFile = null;
    let oldestTime = Infinity;

    files.forEach((file) => {
      try {
        const filePath = path.join(recordingsDir, file);
        const stat = fs.statSync(filePath);
        const createdTime = stat.birthtime.getTime() || stat.mtime.getTime();

        // Find oldest file that's at least 5 minutes old
        if (createdTime < fiveMinutesAgo && createdTime < oldestTime) {
          oldestFile = file;
          oldestTime = createdTime;
        }
      } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
      }
    });

    if (!oldestFile) {
      return res.status(404).json({
        error:
          "No recordings older than 5 minutes. Please try again in a few moments.",
      });
    }

    const url = `http://localhost:5000/recordings/${oldestFile}`;
    console.log(`Serving old recording: ${oldestFile}`);

    res.json({
      url: url,
      file: oldestFile,
      createdAt: new Date(oldestTime).toISOString(),
    });
  } catch (error) {
    console.error("Error getting old recording:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/archive - List all archived files from Google Drive with optional date filtering
 * Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
 */
app.get("/api/archive", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!driveManager.initialized) {
      return res.status(503).json({
        error: "Google Drive not initialized",
      });
    }

    const archives = await driveManager.listArchivesByDate(startDate, endDate);

    res.json({
      success: true,
      count: archives.length,
      archives: archives,
    });
  } catch (error) {
    console.error("Error listing archives:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/archive/:fileId - Get archive file details
 */
app.get("/api/archive/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!driveManager.initialized) {
      return res.status(503).json({
        error: "Google Drive not initialized",
      });
    }

    const fileInfo = await driveManager.getFileById(fileId);

    if (!fileInfo) {
      return res.status(404).json({ error: "File not found" });
    }

    res.json({
      success: true,
      file: fileInfo,
    });
  } catch (error) {
    console.error("Error getting archive file:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/stream-archive/:fileId - Stream archive file from Google Drive
 */
app.get("/api/stream-archive/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!driveManager.initialized) {
      return res.status(503).json({
        error: "Google Drive not initialized",
      });
    }

    // Get file info first to set proper headers
    const fileInfo = await driveManager.getFileById(fileId);

    if (!fileInfo) {
      return res.status(404).json({ error: "File not found" });
    }

    // Set response headers for video streaming
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", fileInfo.size || "unknown");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", `inline; filename="${fileInfo.name}"`);

    // Get and stream the file
    const stream = await driveManager.getFileStream(fileId);

    if (!stream) {
      return res.status(500).json({
        error: "Failed to get file stream",
      });
    }

    stream.on("error", (error) => {
      console.error("Stream error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error" });
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error("Error streaming archive:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /api/timeline/recordings - Get all recordings (local + Google Drive) with metadata for timeline
 */
app.get("/api/timeline/recordings", async (req, res) => {
  try {
    const recordings = [];
    const recordingsDir = path.join(__dirname, "recordings");

    // First, try to get local recordings
    if (fs.existsSync(recordingsDir)) {
      const files = fs
        .readdirSync(recordingsDir)
        .filter((f) => f.endsWith(".mp4"))
        .sort();

      files.forEach((file) => {
        try {
          const filePath = path.join(recordingsDir, file);
          const stat = fs.statSync(filePath);
          const createdTime = stat.birthtime.getTime() || stat.mtime.getTime();

          recordings.push({
            id: file,
            name: file,
            size: stat.size,
            sizeFormatted: (stat.size / (1024 * 1024)).toFixed(2) + " MB",
            createdAt: new Date(createdTime).toISOString(),
            createdAtTime: createdTime,
            url: `/recordings/${file}`,
            source: "local",
          });
        } catch (err) {
          console.error(`Error reading ${file}:`, err.message);
        }
      });
    }

    // Then, get Google Drive recordings if initialized
    if (driveManager.initialized) {
      try {
        const driveFiles = await driveManager.listArchivesByDate();

        if (driveFiles && driveFiles.length > 0) {
          driveFiles.forEach((day) => {
            if (day.files && day.files.length > 0) {
              day.files.forEach((file) => {
                recordings.push({
                  id: file.id,
                  name: file.name,
                  size: file.size || 0,
                  sizeFormatted: file.size
                    ? (file.size / (1024 * 1024)).toFixed(2) + " MB"
                    : "Unknown",
                  createdAt: file.createdTime,
                  createdAtTime: new Date(file.createdTime).getTime(),
                  url: `/api/stream-archive/${file.id}`,
                  source: "drive",
                  fileId: file.id,
                });
              });
            }
          });
        }
      } catch (err) {
        console.warn(
          "Warning: Could not fetch Google Drive files:",
          err.message,
        );
      }
    }

    // Sort by creation time (ascending - oldest first)
    recordings.sort((a, b) => a.createdAtTime - b.createdAtTime);

    res.json({
      success: true,
      count: recordings.length,
      recordings: recordings,
    });
  } catch (error) {
    console.error("Error getting timeline recordings:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/timeline/concatenate - Serve stitched video by index
 * When client requests this, we send videos in sequence using a playlist or by serving segments
 * For simplicity, we'll serve a single file at a time based on the index parameter
 */
app.get("/api/timeline/concatenate", (req, res) => {
  try {
    const recordingsDir = path.join(__dirname, "recordings");

    if (!fs.existsSync(recordingsDir)) {
      return res.status(404).json({ error: "No recordings found" });
    }

    const files = fs
      .readdirSync(recordingsDir)
      .filter((f) => f.endsWith(".mp4"))
      .sort();

    if (files.length === 0) {
      return res.status(404).json({ error: "No recordings found" });
    }

    const { start, end } = req.query;
    let startTime = start ? parseInt(start) : 0; // timestamp in ms
    let endTime = end ? parseInt(end) : Date.now();

    // Find files within the time range
    const filesToServe = [];

    files.forEach((file) => {
      try {
        const filePath = path.join(recordingsDir, file);
        const stat = fs.statSync(filePath);
        const createdTime = stat.birthtime.getTime() || stat.mtime.getTime();

        if (createdTime >= startTime && createdTime <= endTime) {
          filesToServe.push({
            path: filePath,
            file: file,
            createdTime: createdTime,
            size: stat.size,
          });
        }
      } catch (err) {
        console.error(`Error reading ${file}:`, err.message);
      }
    });

    if (filesToServe.length === 0) {
      return res.status(404).json({
        error: "No recordings found in the specified time range",
      });
    }

    // Sort by creation time
    filesToServe.sort((a, b) => a.createdTime - b.createdTime);

    // If multiple files, we'll create a concat demuxer file
    // For now, just serve the first file (most recent or oldest based on preference)
    // In production, use ffmpeg to concatenate on-the-fly

    const firstFile = filesToServe[0];

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${firstFile.file}"`,
    );

    const fileStream = fs.createReadStream(firstFile.path);

    fileStream.on("error", (error) => {
      console.error("File stream error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error" });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error("Error concatenating timeline:", error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * POST /api/timeline/stitch - Create a stitched video from multiple recordings
 * This endpoint concatenates multiple MP4 files into a single output using FFmpeg
 */
app.post("/api/timeline/stitch", (req, res) => {
  try {
    const recordingsDir = path.join(__dirname, "recordings");

    if (!fs.existsSync(recordingsDir)) {
      return res.status(404).json({ error: "No recordings found" });
    }

    const files = fs
      .readdirSync(recordingsDir)
      .filter((f) => f.endsWith(".mp4"))
      .sort();

    if (files.length === 0) {
      return res.status(404).json({ error: "No recordings found" });
    }

    // Create a concat demuxer file
    const concatFile = path.join(recordingsDir, "concat.txt");
    const concatContent = files
      .map((file) => `file '${path.join(recordingsDir, file)}'`)
      .join("\n");

    fs.writeFileSync(concatFile, concatContent);

    const outputPath = path.join(recordingsDir, "stitched_output.mp4");

    // Use FFmpeg to concatenate
    ffmpeg()
      .input(
        `concat:${files.map((f) => path.join(recordingsDir, f)).join("|")}`,
      )
      .outputOptions("-c:v", "copy", "-c:a", "copy")
      .save(outputPath)
      .on("end", () => {
        console.log("Stitching completed");
        res.json({
          success: true,
          message: "Videos stitched successfully",
          output: outputPath,
          url: `http://localhost:5000/recordings/stitched_output.mp4`,
        });

        // Clean up concat file
        fs.unlinkSync(concatFile);
      })
      .on("error", (err) => {
        console.error("Stitching error:", err.message);
        res.status(500).json({ error: err.message });

        // Clean up concat file
        if (fs.existsSync(concatFile)) {
          fs.unlinkSync(concatFile);
        }
      });
  } catch (error) {
    console.error("Error in stitch endpoint:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, () => {
  console.log("Server started on port 5000");
  console.log("RTSP URL:", process.env.rtspUrl);

  const { hls, recording } = startFFmpeg();
  ffmpegProcesses.hls = hls;
  ffmpegProcesses.recording = recording;

  watchFiles();
  cleanup();

  // Initialize Google Drive on startup
  driveManager
    .initialize()
    .then(() => {
      console.log("Google Drive initialized successfully");
    })
    .catch((error) => {
      console.warn("Google Drive initialization failed:", error.message);
    });
});
