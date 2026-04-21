const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
require("dotenv").config();

// Set FFmpeg path explicitly
ffmpeg.setFfmpegPath("C:\\ffmpeg\\bin\\ffmpeg.exe");

const RTSP_URL = process.env.rtspUrl || "rtsp://";

const startFFmpeg = () => {
  console.log("Starting FFmpeg with RTSP URL:", RTSP_URL);

  let hls, recording;

  // HLS STREAM (for frontend) - Low-latency optimized settings
  const hlsCommand = ffmpeg(RTSP_URL)
    .inputOptions([
      "-rtsp_transport tcp", // TCP is more stable than UDP
      "-buffer_size 32768", // Smaller buffer for lower latency
      "-max_delay 500000", // 500ms max delay
    ])
    .outputOptions([
      "-c:v copy", // Copy video codec (no transcoding)
      "-c:a aac", // Audio codec
      "-f hls",
      "-hls_time 1", // 1 second segments for lower latency
      "-hls_list_size 3", // Keep only 3 segments (3 seconds of video)
      "-hls_flags delete_segments+independent_segments",
      "-start_number 0",
      "-preset ultrafast", // Fastest encoding
    ])
    .output(path.join(__dirname, "stream/index.m3u8"))
    .on("start", (cmdline) => {
      console.log("HLS Stream started - optimized for low latency");
      hls = hlsCommand;
    })
    .on("stderr", (stderrLine) => {
      // console.log("[HLS]", stderrLine);
    })
    .on("error", (err) => {
      console.error("HLS Stream error:", err.message);
      console.error("Make sure RTSP password is correct!");
      // Restart after error
      setTimeout(() => {
        console.log("Restarting HLS stream...");
        startFFmpeg();
      }, 5000);
    })
    .on("end", () => {
      console.log("HLS Stream ended");
    })
    .run();

  // RECORDING (1080p segments) - Auto-timestamped with strftime
  const recordCommand = ffmpeg(RTSP_URL)
    .inputOptions([
      "-rtsp_transport tcp", // TCP is more stable
    ])
    .outputOptions([
      "-c:v copy", // keeps original 1080p
      "-c:a aac", // Audio codec
      "-f segment",
      "-segment_time 300", // 5-minute segments (300 seconds)
      "-reset_timestamps 1",
      "-strftime 1", // Enable timestamp in filename
    ])
    .output(path.join(__dirname, "recordings/video_%Y-%m-%d_%I-%M-%S_%p.mp4"))
    .on("start", (cmdline) => {
      console.log("Recording started");
    })
    .on("stderr", (stderrLine) => {
      // console.log("[RECORDING]", stderrLine);
    })
    .on("error", (err) => {
      console.error("Recording error:", err.message);
      console.error("Make sure RTSP password is correct!");
      // Restart after error
      setTimeout(() => {
        console.log("Restarting recording...");
        startFFmpeg();
      }, 5000);
    })
    .on("end", () => {
      console.log("Recording ended");
    })
    .run();

  return { hls, recording };
};

module.exports = startFFmpeg;
