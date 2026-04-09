const fs = require("fs");
const path = require("path");

const cleanup = () => {
  const dir = path.join(__dirname, "recordings");

  setInterval(() => {
    const files = fs.readdirSync(dir)
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(dir, f)).mtime.getTime()
      }))
      .sort((a, b) => a.time - b.time);

    if (files.length > 20) {
      const remove = files.slice(0, files.length - 20);

      remove.forEach(file => {
        fs.unlinkSync(path.join(dir, file.name));
        console.log("Deleted:", file.name);
      });
    }
  }, 60000);
};

module.exports = cleanup;