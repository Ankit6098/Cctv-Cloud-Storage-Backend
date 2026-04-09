const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
require('dotenv').config()

// Set FFmpeg path explicitly
ffmpeg.setFfmpegPath("C:\\ffmpeg\\bin\\ffmpeg.exe");

const RTSP_URL = process.env.rtspUrl || "rtsp://";

const startFFmpeg = () => {
  // HLS STREAM (for frontend)
  const hlsCommand = ffmpeg(RTSP_URL)
    .inputOptions(["-rtsp_transport udp"])
    .outputOptions([
      "-c:v libx264",
      "-preset veryfast",
      "-tune zerolatency",
      "-f hls",
      "-hls_time 2",
      "-hls_list_size 5",
      "-hls_flags delete_segments",
    ])
    .output(path.join(__dirname, "stream/index.m3u8"))
    .on("error", (err) => {
      console.error("HLS Stream error:", err.message);
    })
    .on("end", () => {
      console.log("HLS Stream ended");
    })
    .run();

  // RECORDING (1080p segments)
  const recordCommand = ffmpeg(RTSP_URL)
    .inputOptions(["-rtsp_transport udp"])
    .outputOptions([
      "-c:v copy", // keeps original 1080p
      "-f segment",
      "-segment_time 60",
      "-reset_timestamps 1",
    ])
    .output(path.join(__dirname, "recordings/video_%03d.mp4"))
    .on("error", (err) => {
      console.error("Recording error:", err.message);
    })
    .on("end", () => {
      console.log("Recording ended");
    })
    .run();
};

module.exports = startFFmpeg;
