const chokidar = require("chokidar");
const { uploadFile } = require("./upload");

const watchFiles = () => {
  chokidar
    .watch("./recordings", {
      ignored: /(^|[\/\\])\.|\.DS_Store/,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 25000, // Wait 25 seconds - 5min segment takes time to finalize
        pollInterval: 100,
      },
    })
    .on("add", (filePath) => {
      console.log(`📹 New recording detected: ${filePath}`);
      uploadFile(filePath);
    })
    .on("error", (error) => {
      console.error("Watcher error:", error);
    });

  console.log("👀 File watcher started for ./recordings");
};

module.exports = watchFiles;
