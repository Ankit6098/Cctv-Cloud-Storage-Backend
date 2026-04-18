const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
require("dotenv").config();

// Set FFmpeg path explicitly
ffmpeg.setFfmpegPath("C:\\ffmpeg\\bin\\ffmpeg.exe");

const RTSP_URL = process.env.rtspUrl || "rtsp://";

const startFFmpeg = () => {
  console.log("Starting FFmpeg with RTSP URL:", RTSP_URL);

  let hls, recording;

  // HLS STREAM (for frontend) - Use copy codec for faster streaming
  const hlsCommand = ffmpeg(RTSP_URL)
    .inputOptions([
      "-rtsp_transport tcp", // TCP is more stable than UDP
    ])
    .outputOptions([
      "-c:v copy", // Copy video codec (no transcoding)
      "-c:a aac", // Audio codec
      "-f hls",
      "-hls_time 2",
      "-hls_list_size 5",
      "-hls_flags delete_segments",
      "-start_number 0",
    ])
    .output(path.join(__dirname, "stream/index.m3u8"))
    .on("start", (cmdline) => {
      // console.log("HLS Stream started");
      // console.log("Command:", cmdline);
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
        // console.log("Restarting HLS stream...");
        startFFmpeg();
      }, 5000);
    })
    .on("end", () => {
      // console.log("HLS Stream ended");
    })
    .run();

  // RECORDING (1080p segments)
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
    ])
    .output(path.join(__dirname, "recordings/video_%03d.mp4"))
    .on("start", (cmdline) => {
      // console.log("Recording started");
      // console.log("Command:", cmdline);
      recording = recordCommand;
    })
    .on("stderr", (stderrLine) => {
      // console.log("[RECORDING]", stderrLine);
    })
    .on("error", (err) => {
      console.error("Recording error:", err.message);
      console.error("Make sure RTSP password is correct!");
      // Restart after error
      setTimeout(() => {
        // console.log("Restarting recording...");
        startFFmpeg();
      }, 5000);
    })
    .on("end", () => {
      // console.log("Recording ended");
    })
    .run();

  return { hls, recording };
};

module.exports = startFFmpeg;
