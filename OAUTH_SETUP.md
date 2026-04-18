# 🔐 OAuth 2.0 Setup Guide for CCTV Cloud Storage

This guide explains how to set up OAuth 2.0 authentication for uploading CCTV recordings to your personal Google Drive.

---

## 📋 **Complete Step-by-Step Setup**

### **STEP 1: Create OAuth 2.0 Credentials** ⚙️

#### 1.1 Go to Google Cloud Console

- Open: https://console.cloud.google.com
- **Important**: Log in with the Google account that owns the Google Drive folder where you want to upload recordings

#### 1.2 Create a New Project

- Top left corner: Click the **project dropdown**
- Click **"NEW PROJECT"**
- Project name: `CCTV Recorder`
- Click **"CREATE"**
- Wait for project to be created

#### 1.3 Enable Google Drive API

- Left sidebar: **"APIs & Services"** → **"Library"**
- Search box: Type `Google Drive API`
- Click on **"Google Drive API"**
- Click **"ENABLE"**

#### 1.4 Create Consent Screen

- Left sidebar: **"APIs & Services"** → **"Credentials"**
- Click **"+ CREATE CREDENTIALS"** button
- If asked for "OAuth consent screen", click **"CONFIGURE CONSENT SCREEN"**
- Choose User Type: **"External"**
- Click **"CREATE"**
- Fill in the form:
  - App name: `CCTV Recorder`
  - User support email: (your email address)
  - Developer contact: (your email address)
- Click **"SAVE AND CONTINUE"**
- Click **"SAVE AND CONTINUE"** again (scopes page)
- Click **"SAVE AND CONTINUE"** again (test users page)
- Click **"BACK TO DASHBOARD"**

#### 1.5 Create OAuth Client Credentials

- Left sidebar: **"APIs & Services"** → **"Credentials"**
- Click **"+ CREATE CREDENTIALS"**
- Choose: **"OAuth 2.0 Client IDs"**
- Application type: **"Desktop application"**
- Name: `CCTV Desktop Client`
- Click **"CREATE"**
- You'll see a popup showing your credentials (you can close it)

#### 1.6 Download Credentials JSON

- In the credentials list, find your just-created credentials
- Click the **download icon** (⬇️) on the right side
- File will be named: `client_secret_*.json`
- **Rename it to: `oauth-credentials.json`**
- Move it to your Backend folder:
  ```
  Cctv Cloud Storage Backend/oauth-credentials.json
  ```

---

### **STEP 2: Create Folder in Google Drive** 📁

1. Go to your Google Drive: https://drive.google.com
2. Right-click in empty space → **"New folder"**
3. Name it: `CCTV Recordings` (or any name you prefer)
4. Open the folder
5. Copy the folder ID from the URL bar:
   ```
   https://drive.google.com/drive/folders/FOLDER_ID_HERE
   ```
6. **Save this ID** (you'll need it in .env)

---

### **STEP 3: Update .env File** 🔧

Create or update `.env` file in your Backend folder:

```env
# RTSP Camera Configuration
rtspUrl="rtsp://admin:PASSWORD@192.168.0.100:5543/live/channel0"

# Google Drive Folder ID (from STEP 2)
SHARED_DRIVE_ID="1abc_def123xyz456..."

# Storage Limit (in GB)
STORAGE_LIMIT_GB=12
```

---

### **STEP 4: Install New Dependencies** 📦

```bash
cd "Cctv Cloud Storage Backend"
npm install
```

This installs the OAuth authentication library.

---

### **STEP 5: First Run - Browser Authentication** 🌐

When you start the backend for the first time:

```bash
npm start
```

You'll see:

```
🔐 First time setup - Opening browser for authentication...
```

- A browser window will **automatically open**
- **Log in with your Google account** (the one that owns the folder)
- Click **"Allow"** to grant permissions
- You'll see a success message
- **DO NOT CLOSE** the backend terminal
- The backend will automatically continue

After authentication:

```
✓ Authentication successful! Token saved.
✓ Google Drive initialized with OAuth 2.0
```

---

### **STEP 6: Future Runs** ✅

Next time you start the backend:

```bash
npm start
```

It will use the saved token automatically - **no browser needed!**

The backend will directly start uploading:

```
Server started on port 5000
RTSP URL: rtsp://admin:PASSWORD@...
✓ Google Drive initialized with OAuth 2.0
👀 File watcher started for ./recordings
📹 New recording detected: recordings\video_001.mp4
📋 Added to queue: video_001.mp4
Uploading: video_001.mp4 (4.2 MB)
✓ Uploaded: video_001.mp4
```

---

## 📂 **File Structure After Setup**

Your Backend folder should look like:

```
Cctv Cloud Storage Backend/
  ├── oauth-credentials.json    (downloaded from Google Cloud)
  ├── token.json               (auto-generated after first run)
  ├── .env                     (your configuration)
  ├── server.js
  ├── driveManager.js
  ├── upload.js
  ├── cleanup.js
  ├── watcher.js
  ├── package.json
  └── ... other files
```

---

## 🔍 **Verify It's Working**

After first authentication, check Google Drive:

1. Open your `CCTV Recordings` folder
2. You should see automatically created folders:
   ```
   📁 2026
     📁 04 - April
       📁 18
         📄 video_001.mp4
         📄 video_002.mp4
   ```

Files organized by **Year/Month/Date** automatically! 🎉

---

## ⚠️ **Troubleshooting**

### **"oauth-credentials.json not found"**

- Make sure you downloaded the JSON file from Google Cloud Console
- Rename it to exactly: `oauth-credentials.json`
- Place it in the Backend folder

### **Browser doesn't open for authentication**

- The URL will be printed in terminal
- Copy and paste it into your browser manually
- You should still get the success message

### **"Failed to initialize Google Drive"**

- Check if `oauth-credentials.json` exists
- Make sure you're logged into the correct Google account
- Try deleting `token.json` and restart (will re-authenticate)

### **Uploads not working**

- Check the folder ID in `.env` is correct
- Verify folder exists in your Google Drive
- Check backend logs for error messages

---

## 🔑 **Security Notes**

- `oauth-credentials.json`: Keep this private, don't share it
- `token.json`: Auto-generated, handles authentication
- Both files should be in `.gitignore` (they are)
- Only you can authenticate with your Google account

---

## ✨ **What Happens Automatically**

Once set up, the system will:

1. ✅ Detect new recordings in the `recordings/` folder
2. ✅ Add them to an upload queue
3. ✅ Upload sequentially (one at a time)
4. ✅ Create folders by date automatically
5. ✅ Manage 12GB storage limit
6. ✅ Auto-delete oldest files when storage is full
7. ✅ Retry failed uploads every 5 minutes

**No manual intervention needed!** 🚀

---

## 📞 **Need Help?**

If you encounter issues:

1. Check the backend console logs
2. Verify `oauth-credentials.json` is in the right place
3. Delete `token.json` and restart to re-authenticate
4. Check Google Cloud Console to confirm APIs are enabled

---

**Version**: 2.1 (OAuth 2.0)  
**Last Updated**: April 18, 2026
