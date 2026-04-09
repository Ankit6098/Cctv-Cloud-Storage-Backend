const chokidar = require("chokidar");
const uploadFile = require("./upload");

const watchFiles = () => {
  chokidar.watch("./recordings").on("add", (path) => {
    console.log("New file detected:", path);
    uploadFile(path);
  });
};

module.exports = watchFiles;