const express = require("express");
const cors = require("cors");

const startFFmpeg = require("./ffmpeg");
const watchFiles = require("./watcher");
const cleanup = require("./cleanup");
require('dotenv').config()

const app = express();
app.use(cors());

app.use("/stream", express.static("stream"));

app.get("/", (req, res) => {
  res.send("CCTV Backend Running");
});

app.listen(5000, () => {
  console.log("Server started on port 5000");

  startFFmpeg();
  watchFiles();
  cleanup();
});