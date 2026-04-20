const driveManager = require("./driveManager");
const fs = require("fs");
const path = require("path");

/**
 * Rename file with date and time format: YYYY-MM-DD_HH-MM-SS_AM/PM.mp4
 * Subtracts 5 minutes from mtime to get actual footage START time
 */
const renameFileWithTimestamp = async (filePath) => {
  try {
    const dir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName);

    // Get file's modification time (when writing finished)
    const fileStats = fs.statSync(filePath);
    let fileDate = new Date(fileStats.mtime);

    // Subtract 5 minutes to get actual footage start time (accounting for hour/day boundaries)
    fileDate.setMinutes(fileDate.getMinutes() - 5);

    // Format: YYYY-MM-DD_HH-MM-SS_AM/PM
    const year = fileDate.getFullYear();
    const month = String(fileDate.getMonth() + 1).padStart(2, "0");
    const day = String(fileDate.getDate()).padStart(2, "0");

    const hoursIn24 = fileDate.getHours();
    const ampm = hoursIn24 >= 12 ? "PM" : "AM";
    const hoursIn12 = hoursIn24 % 12 || 12; // Convert to 12-hour format
    const hours = String(hoursIn12).padStart(2, "0");
    const minutes = String(fileDate.getMinutes()).padStart(2, "0");
    const seconds = String(fileDate.getSeconds()).padStart(2, "0");

    const newFileName = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}_${ampm}${ext}`;
    const newFilePath = path.join(dir, newFileName);

    // Rename the file
    fs.renameSync(filePath, newFilePath);
    console.log(
      `✏️  Renamed: ${fileName} → ${newFileName} (Start time: 5 min earlier)`,
    );

    return newFilePath;
  } catch (error) {
    console.error(`Error renaming file ${filePath}:`, error.message);
    return null;
  }
};

// Upload queue for sequential processing
class UploadQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.retryLimit = 3;
  }

  /**
   * Add file to upload queue
   * File is considered ready because watcher.js waits 60 seconds for write stabilization
   * Prevents duplicate uploads of the same file
   */
  addToQueue(filePath) {
    try {
      // Verify file still exists before queueing
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  File not found: ${filePath}`);
        return;
      }

      // Check if file is already in queue (prevent duplicates)
      const fileName = path.basename(filePath);
      const isDuplicate = this.queue.some(
        (item) => path.basename(item.filePath) === fileName,
      );

      if (isDuplicate) {
        console.warn(
          `⚠️  Duplicate detected: ${fileName} already in queue - skipping`,
        );
        return;
      }

      const stats = fs.statSync(filePath);
      const fileSizeInMB = stats.size / (1024 * 1024);

      this.queue.push({
        filePath,
        retries: 0,
        addedAt: new Date(),
      });

      console.log(
        `📋 Added to queue: ${fileName} (${fileSizeInMB.toFixed(2)}MB) - (Queue size: ${this.queue.length})`,
      );
      this.processQueue();
    } catch (error) {
      console.error(`Error adding to queue: ${error.message}`);
    }
  }

  /**
   * Process upload queue sequentially
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];

      try {
        // Check if file exists
        if (!fs.existsSync(item.filePath)) {
          console.warn(
            `⚠️  File not found, removing from queue: ${item.filePath}`,
          );
          this.queue.shift();
          continue;
        }

        // Rename file with timestamp (YYYY-MM-DD_HH-MM-SS.mp4)
        const renamedPath = await renameFileWithTimestamp(item.filePath);

        if (!renamedPath) {
          console.error(`Failed to rename file: ${item.filePath}`);
          item.retries++;
          if (item.retries >= this.retryLimit) {
            console.error(
              `❌ Failed after ${this.retryLimit} retries: ${item.filePath}`,
            );
            this.queue.shift();
          }
          break;
        }

        // Get current date folder path
        const parentFolderId = await driveManager.getFolderPath();

        if (!parentFolderId) {
          console.error("Failed to get Drive folder, will retry...");
          item.retries++;

          if (item.retries >= this.retryLimit) {
            console.error(
              `❌ Failed after ${this.retryLimit} retries: ${renamedPath}`,
            );
            this.queue.shift();
          }
          break; // Stop processing, retry later
        }

        // Upload renamed file
        await driveManager.uploadFile(renamedPath, parentFolderId);

        // Remove from queue after successful upload
        this.queue.shift();
        console.log(`✅ Upload completed. Queue size: ${this.queue.length}`);
      } catch (error) {
        console.error(`Error uploading ${item.filePath}:`, error.message);
        item.retries++;

        if (item.retries >= this.retryLimit) {
          console.error(`❌ Max retries reached for: ${item.filePath}`);
          this.queue.shift();
        } else {
          console.log(
            `Retrying... (Attempt ${item.retries}/${this.retryLimit})`,
          );
          break; // Stop processing, retry later
        }
      }

      // Add small delay between uploads to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.isProcessing = false;
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      pendingFiles: this.queue.map((item) => ({
        file: path.basename(item.filePath),
        retries: item.retries,
        addedAt: item.addedAt,
      })),
    };
  }
}

// Create singleton queue instance
const uploadQueue = new UploadQueue();

// Retry failed uploads every 5 minutes
setInterval(
  () => {
    if (uploadQueue.queue.length > 0 && !uploadQueue.isProcessing) {
      console.log(`⏰ Retrying ${uploadQueue.queue.length} pending uploads...`);
      uploadQueue.processQueue();
    }
  },
  5 * 60 * 1000,
); // 5 minutes

/**
 * Main upload function - adds file to queue
 */
const uploadFile = async (filePath) => {
  if (!driveManager.initialized) {
    await driveManager.initialize();
  }

  if (!process.env.SHARED_DRIVE_ID) {
    console.log(
      "⚠️  Shared Drive ID not configured. File will be queued locally.",
    );
  }

  uploadQueue.addToQueue(filePath);
};

module.exports = { uploadFile, uploadQueue };
