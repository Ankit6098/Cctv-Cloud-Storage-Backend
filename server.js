const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

const startFFmpeg = require("./ffmpeg");
const watchFiles = require("./watcher");
const cleanup = require("./cleanup");
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

  // Check file sizes
  const recordingFile = path.join(__dirname, "recordings/video_000.mp4");
  const m3u8File = path.join(__dirname, "stream/index.m3u8");

  let recordingSize = 0;
  let m3u8Exists = false;

  try {
    if (fs.existsSync(recordingFile)) {
      recordingSize = fs.statSync(recordingFile).size;
    }
    m3u8Exists = fs.existsSync(m3u8File);
  } catch (err) {
    console.error("Error checking files:", err);
  }

  res.json({
    status: "running",
    rtspUrl: rtspUrl,
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

app.listen(5000, () => {
  console.log("Server started on port 5000");
  console.log("RTSP URL:", process.env.rtspUrl);

  const { hls, recording } = startFFmpeg();
  ffmpegProcesses.hls = hls;
  ffmpegProcesses.recording = recording;

  watchFiles();
  cleanup();
});
