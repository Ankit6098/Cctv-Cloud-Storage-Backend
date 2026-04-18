const fs = require("fs");
const path = require("path");
const driveManager = require("./driveManager");

// Storage management configuration
const STORAGE_LIMIT_GB = process.env.STORAGE_LIMIT_GB || 12;
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_GB * 1024 * 1024 * 1024;
const CHECK_INTERVAL = 60 * 1000; // Check every 1 minute

/**
 * Calculate total size of local recordings
 */
function getLocalStorageSize() {
  const dir = path.join(__dirname, "recordings");

  if (!fs.existsSync(dir)) {
    return 0;
  }

  try {
    const files = fs.readdirSync(dir);
    let totalSize = 0;

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      } catch (err) {
        console.error(`Error reading file ${file}:`, err.message);
      }
    });

    return totalSize;
  } catch (err) {
    console.error("Error calculating local storage size:", err.message);
    return 0;
  }
}

/**
 * Get list of local files sorted by modification time
 */
function getLocalFilesList() {
  const dir = path.join(__dirname, "recordings");

  if (!fs.existsSync(dir)) {
    return [];
  }

  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => fs.statSync(path.join(dir, f)).isFile())
      .map((f) => ({
        name: f,
        path: path.join(dir, f),
        size: fs.statSync(path.join(dir, f)).size,
        time: fs.statSync(path.join(dir, f)).mtime.getTime(),
        uploaded: checkIfUploaded(f), // Track if uploaded to Drive
      }))
      .sort((a, b) => a.time - b.time); // Oldest first

    return files;
  } catch (err) {
    console.error("Error getting files list:", err.message);
    return [];
  }
}

/**
 * Check if file was uploaded (simple check: file exists in upload queue status)
 * In production, you might want to track this in a database
 */
function checkIfUploaded(fileName) {
  // For now, we'll assume files are uploaded after 5 minutes of no changes
  const recordingsDir = path.join(__dirname, "recordings");
  const filePath = path.join(recordingsDir, fileName);

  try {
    const stats = fs.statSync(filePath);
    const fileAge = Date.now() - stats.mtime.getTime();
    return fileAge > 5 * 60 * 1000; // Older than 5 minutes = likely uploaded
  } catch {
    return false;
  }
}

/**
 * Delete old local files when storage exceeds limit
 */
function cleanupLocalStorage() {
  const dir = path.join(__dirname, "recordings");

  if (!fs.existsSync(dir)) {
    return;
  }

  const currentSize = getLocalStorageSize();
  const percentUsed = (currentSize / STORAGE_LIMIT_BYTES) * 100;

  if (currentSize > STORAGE_LIMIT_BYTES) {
    console.warn(
      `⚠️  Storage limit exceeded! ${driveManager.formatBytes(currentSize)} / ${STORAGE_LIMIT_GB}GB (${percentUsed.toFixed(1)}%)`,
    );

    const files = getLocalFilesList();
    let deletedSize = 0;
    let deletedCount = 0;

    // Delete oldest files until we're below 90% of limit
    const targetSize = (STORAGE_LIMIT_BYTES * 90) / 100;

    for (const file of files) {
      if (currentSize - deletedSize <= targetSize) {
        break;
      }

      try {
        // Only delete uploaded files to avoid losing unuploaded data
        if (file.uploaded) {
          fs.unlinkSync(file.path);
          deletedSize += file.size;
          deletedCount++;
          console.log(
            `🗑️  Deleted: ${file.name} (${driveManager.formatBytes(file.size)})`,
          );
        }
      } catch (err) {
        console.error(`Error deleting file ${file.name}:`, err.message);
      }
    }

    if (deletedCount > 0) {
      const newSize = getLocalStorageSize();
      const newPercent = (newSize / STORAGE_LIMIT_BYTES) * 100;
      console.log(
        `✅ Cleanup complete: Deleted ${deletedCount} files (${driveManager.formatBytes(deletedSize)})`,
      );
      console.log(
        `📊 Storage: ${driveManager.formatBytes(newSize)} / ${STORAGE_LIMIT_GB}GB (${newPercent.toFixed(1)}%)`,
      );
    }
  } else if (percentUsed > 80) {
    console.log(
      `⚠️  Storage usage: ${driveManager.formatBytes(currentSize)} / ${STORAGE_LIMIT_GB}GB (${percentUsed.toFixed(1)}%)`,
    );
  } else {
    console.log(
      `✅ Storage usage: ${driveManager.formatBytes(currentSize)} / ${STORAGE_LIMIT_GB}GB (${percentUsed.toFixed(1)}%)`,
    );
  }
}

/**
 * Delete old files from Google Drive when storage exceeds limit there
 */
async function cleanupDriveStorage() {
  if (!driveManager.initialized) {
    await driveManager.initialize();
  }

  if (!process.env.SHARED_DRIVE_ID) {
    return; // Drive not configured
  }

  try {
    const driveSize = await driveManager.getStorageSize(
      process.env.SHARED_DRIVE_ID,
    );
    const percentUsed = (driveSize / STORAGE_LIMIT_BYTES) * 100;

    if (driveSize > STORAGE_LIMIT_BYTES) {
      console.warn(
        `⚠️  Drive storage limit exceeded! ${driveManager.formatBytes(driveSize)} / ${STORAGE_LIMIT_GB}GB`,
      );

      const oldestFiles = await driveManager.getOldestFiles(
        process.env.SHARED_DRIVE_ID,
        50,
      );

      let deletedSize = 0;
      const targetSize = (STORAGE_LIMIT_BYTES * 90) / 100;

      for (const file of oldestFiles) {
        if (driveSize - deletedSize <= targetSize) {
          break;
        }

        const fileSize = parseInt(file.size) || 0;
        const deleted = await driveManager.deleteFile(file.id);

        if (deleted) {
          deletedSize += fileSize;
          console.log(
            `🗑️  Deleted from Drive: ${file.name} (${driveManager.formatBytes(fileSize)})`,
          );
        }
      }

      if (deletedSize > 0) {
        console.log(
          `✅ Drive cleanup complete: Freed ${driveManager.formatBytes(deletedSize)}`,
        );
      }
    } else if (percentUsed > 80) {
      console.log(
        `⚠️  Drive storage usage: ${driveManager.formatBytes(driveSize)} / ${STORAGE_LIMIT_GB}GB (${percentUsed.toFixed(1)}%)`,
      );
    }
  } catch (error) {
    console.error("Error during Drive cleanup:", error.message);
  }
}

/**
 * Start periodic cleanup checks
 */
const cleanup = () => {
  console.log(
    `⚙️  Storage management initialized (Limit: ${STORAGE_LIMIT_GB}GB, Check interval: every ${CHECK_INTERVAL / 1000}s)`,
  );

  // Check local storage every minute
  setInterval(() => {
    cleanupLocalStorage();
  }, CHECK_INTERVAL);

  // Check Drive storage every 5 minutes
  setInterval(() => {
    cleanupDriveStorage();
  }, 5 * CHECK_INTERVAL);

  // Run immediately on startup
  cleanupLocalStorage();
  cleanupDriveStorage();
};

module.exports = cleanup;
