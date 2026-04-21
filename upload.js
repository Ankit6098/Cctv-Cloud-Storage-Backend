const driveManager = require("./driveManager");
const fs = require("fs");
const path = require("path");

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
   * FFmpeg auto-timestamps files with -strftime, so no rename needed
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
   * Files are already timestamped by FFmpeg's -strftime, so skip rename step
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

        // Get current date folder path
        const parentFolderId = await driveManager.getFolderPath();

        if (!parentFolderId) {
          console.error("Failed to get Drive folder, will retry...");
          item.retries++;

          if (item.retries >= this.retryLimit) {
            console.error(
              `❌ Failed after ${this.retryLimit} retries: ${item.filePath}`,
            );
            this.queue.shift();
          }
          break; // Stop processing, retry later
        }

        // Upload file directly (already timestamped by FFmpeg)
        const fileName = path.basename(item.filePath);
        console.log(`📤 Uploading: ${fileName}`);
        await driveManager.uploadFile(item.filePath, parentFolderId);

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
