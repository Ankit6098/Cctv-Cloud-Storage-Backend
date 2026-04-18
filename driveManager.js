const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");

class DriveManager {
  constructor() {
    this.drive = null;
    this.rootFolderId = process.env.SHARED_DRIVE_ID || null;
    this.folderCache = {};
    this.initialized = false;
    this.tokenPath = path.join(__dirname, "token.json");
    this.credentialsPath = path.join(__dirname, "oauth-credentials.json");
  }

  async initialize() {
    try {
      const auth = await this.loadAuth();
      this.drive = google.drive({
        version: "v3",
        auth: auth,
      });
      this.initialized = true;
      console.log("✓ Google Drive initialized with OAuth 2.0");
      return true;
    } catch (error) {
      console.error("✗ Failed to initialize Google Drive:", error.message);
      return false;
    }
  }

  /**
   * Load or create OAuth2 token
   */
  async loadAuth() {
    try {
      // Try to load existing token
      if (fs.existsSync(this.tokenPath)) {
        const token = JSON.parse(fs.readFileSync(this.tokenPath, "utf-8"));
        const auth = new google.auth.OAuth2(
          token.client_id,
          token.client_secret,
          token.redirect_uris[0],
        );
        auth.setCredentials(token);
        return auth;
      }

      // Create new token via browser
      if (!fs.existsSync(this.credentialsPath)) {
        throw new Error(
          `oauth-credentials.json not found in ${__dirname}\n` +
            "Download it from Google Cloud Console: https://console.cloud.google.com/apis/credentials",
        );
      }

      console.log(
        "🔐 First time setup - Opening browser for authentication...",
      );
      const auth = await authenticate({
        scopes: [
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/drive.file",
        ],
        keyfilePath: this.credentialsPath,
      });

      // Save token for future use
      const credentials = JSON.parse(
        fs.readFileSync(this.credentialsPath, "utf-8"),
      );
      const token = {
        ...auth.credentials,
        client_id: credentials.installed.client_id,
        client_secret: credentials.installed.client_secret,
        redirect_uris: credentials.installed.redirect_uris,
      };

      fs.writeFileSync(this.tokenPath, JSON.stringify(token, null, 2));
      console.log("✓ Authentication successful! Token saved.\n");

      return auth;
    } catch (error) {
      console.error("Authentication error:", error.message);
      throw error;
    }
  }

  /**
   * Get or create a folder in Google Drive
   * Structure: Root > Year > Month > Date
   */
  async getFolderPath(date = new Date()) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.rootFolderId) {
      console.warn("Root folder ID not configured in SHARED_DRIVE_ID");
      return null;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const cacheKey = `${year}-${month}-${day}`;

    if (this.folderCache[cacheKey]) {
      return this.folderCache[cacheKey];
    }

    try {
      const yearFolderId = await this.getOrCreateFolder(
        `${year}`,
        this.rootFolderId,
      );
      const monthFolderId = await this.getOrCreateFolder(
        `${month} - ${this.getMonthName(month)}`,
        yearFolderId,
      );
      const dateFolderId = await this.getOrCreateFolder(
        `${day}`,
        monthFolderId,
      );

      this.folderCache[cacheKey] = dateFolderId;
      return dateFolderId;
    } catch (error) {
      console.error("Error getting folder path:", error.message);
      return null;
    }
  }

  /**
   * Get or create a folder by name in a parent folder
   */
  async getOrCreateFolder(folderName, parentId) {
    try {
      const query = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parentId}' in parents`;

      const response = await this.drive.files.list({
        q: query,
        spaces: "drive",
        fields: "files(id, name)",
        pageSize: 1,
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id;
      }

      const createResponse = await this.drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parentId],
        },
        fields: "id",
      });

      console.log(`Created folder: ${folderName}`);
      return createResponse.data.id;
    } catch (error) {
      console.error(`Error with folder '${folderName}':`, error.message);
      throw error;
    }
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(filePath, parentFolderId) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!parentFolderId) {
      console.warn("Parent folder ID not provided");
      return null;
    }

    try {
      const fileName = path.basename(filePath);
      const fileSize = fs.statSync(filePath).size;

      console.log(`Uploading: ${fileName} (${this.formatBytes(fileSize)})`);

      const response = await this.drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [parentFolderId],
          },
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: "id, size, createdTime",
        },
        { timeout: 60000 },
      );

      console.log(`✓ Uploaded: ${fileName}`);
      return response.data;
    } catch (error) {
      console.error(`✗ Upload failed for ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Get total storage size of recordings folder on Drive
   */
  async getStorageSize(parentFolderId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const response = await this.drive.files.list({
        q: `'${parentFolderId}' in parents and trashed=false`,
        spaces: "drive",
        fields: "files(size)",
        pageSize: 1000,
      });

      let totalSize = 0;
      if (response.data.files) {
        totalSize = response.data.files.reduce((sum, file) => {
          return sum + (parseInt(file.size) || 0);
        }, 0);
      }

      return totalSize;
    } catch (error) {
      console.error("Error getting storage size:", error.message);
      return 0;
    }
  }

  /**
   * Get oldest files from Drive for deletion
   */
  async getOldestFiles(parentFolderId, limit = 10) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const response = await this.drive.files.list({
        q: `'${parentFolderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
        spaces: "drive",
        fields: "files(id, name, size, createdTime)",
        pageSize: limit,
        orderBy: "createdTime",
      });

      return response.data.files || [];
    } catch (error) {
      console.error("Error getting oldest files:", error.message);
      return [];
    }
  }

  /**
   * Delete a file from Google Drive
   */
  async deleteFile(fileId) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      await this.drive.files.delete({ fileId: fileId });
      console.log(`✓ Deleted from Drive: ${fileId}`);
      return true;
    } catch (error) {
      console.error(`Error deleting file:`, error.message);
      return false;
    }
  }

  getMonthName(monthNumber) {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return months[parseInt(monthNumber) - 1];
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }
}

module.exports = new DriveManager();
