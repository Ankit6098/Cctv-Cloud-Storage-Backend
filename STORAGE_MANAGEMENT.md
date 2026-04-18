# CCTV Cloud Storage - Enhanced Storage Management Guide

## 📋 Overview

This enhanced system provides:

1. **Automatic Google Drive Upload** - Sequential processing of recordings
2. **Organized Folder Structure** - Automatic year/month/date hierarchy
3. **Storage Limit Management** - 12GB limit with automatic cleanup
4. **Upload Queue Monitoring** - Real-time status of pending uploads

---

## 🔧 Setup Instructions

### 1. Google Drive Configuration

#### Get Shared Drive ID:

1. Open [Google Drive](https://drive.google.com)
2. Right-click on your desired folder
3. Copy the folder ID from the URL: `https://drive.google.com/drive/folders/YOUR-FOLDER-ID`
4. Add to `.env`: `SHARED_DRIVE_ID="YOUR-FOLDER-ID"`

#### Create Service Account:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project or select existing
3. Enable Google Drive API
4. Create Service Account with Editor role
5. Download JSON key and save as `credentials.json` in Backend folder

### 2. Environment Variables

Create `.env` file in Backend folder:

```env
# RTSP Camera
rtspUrl="rtsp://admin:PASSWORD@192.168.0.100:5543/live/channel0"

# Google Drive (your shared drive folder ID)
SHARED_DRIVE_ID="1234567890abcdefghijklmnop"

# Storage limit in GB (default: 12)
STORAGE_LIMIT_GB=12
```

---

## 📊 Folder Structure on Google Drive

Recordings are automatically organized as:

```
📁 Your Shared Drive
├── 📁 2026
│   ├── 📁 01 - January
│   │   ├── 📁 15
│   │   │   └── video_001.mp4
│   │   │   └── video_002.mp4
│   │   └── 📁 16
│   │       └── video_003.mp4
│   └── 📁 02 - February
│       └── 📁 01
│           └── video_004.mp4
```

**Format**: `YEAR/MM - Month Name/DD/filename`

---

## 🔄 How It Works

### Upload Flow:

```
Recording Created
    ↓
Added to Upload Queue
    ↓
Sequential Upload (1 file at a time)
    ↓
Auto-Retry (3 attempts) if failed
    ↓
Uploaded to Drive in proper folder
```

### Storage Management:

```
Recording Added
    ↓
Check Total Size (Local + Drive)
    ↓
Exceeds 12GB?
    ├─ YES → Delete oldest uploaded files
    └─ NO → Continue
```

---

## 📡 API Endpoints

### Get Storage Status

```bash
GET /api/storage
```

Response:

```json
{
  "local": {
    "size": 5368709120,
    "sizeFormatted": "5 GB",
    "fileCount": 15
  },
  "drive": {
    "size": 3221225472,
    "sizeFormatted": "3 GB",
    "configured": true
  },
  "total": {
    "size": 8589934592,
    "sizeFormatted": "8 GB",
    "limitGB": 12,
    "percentUsed": "71.6"
  }
}
```

### Get Upload Queue Status

```bash
GET /api/upload-queue
```

Response:

```json
{
  "queueSize": 3,
  "isProcessing": true,
  "pendingFiles": [
    {
      "file": "video_001.mp4",
      "retries": 0,
      "addedAt": "2026-04-18T10:30:00.000Z"
    }
  ]
}
```

### Get Google Drive Info

```bash
GET /api/drive-info
```

### Trigger Manual Cleanup

```bash
POST /api/manual-cleanup
```

---

## 🚀 Starting the System

### Backend:

```bash
cd "Cctv Cloud Storage Backend"
npm install
npm start
```

### Frontend:

```bash
cd "Cctv Cloud Storage Frontend"
npm install
npm run dev
```

Access at: http://localhost:3000

---

## 📊 Monitoring

### Real-time Logs:

Watch backend console for:

- `📹 New recording detected`
- `📋 Added to queue`
- `⏫ Uploading...`
- `✅ Uploaded`
- `🗑️ Deleted` (cleanup)
- `📊 Storage usage`

### Dashboard API:

Check storage anytime:

```bash
curl http://localhost:5000/api/storage
curl http://localhost:5000/api/upload-queue
```

---

## ⚙️ Configuration Options

| Variable           | Default | Description                     |
| ------------------ | ------- | ------------------------------- |
| `STORAGE_LIMIT_GB` | 12      | Max storage before auto-cleanup |
| `SHARED_DRIVE_ID`  | -       | Google Drive folder ID          |
| `rtspUrl`          | -       | RTSP camera stream URL          |

---

## 🔍 Troubleshooting

### No uploads happening:

- Check `SHARED_DRIVE_ID` in .env
- Verify `credentials.json` exists
- Check API response: `/api/drive-info`

### Storage not cleaning up:

- Check if files have been uploaded (waits 5 min before deletion)
- Verify `STORAGE_LIMIT_GB` is set correctly
- Check console for cleanup logs

### Uploads failing:

- Verify Google Drive permissions
- Check internet connection
- Monitor queue: `/api/upload-queue`
- Max 3 retries per file

---

## 📝 Files Modified

- `upload.js` - Sequential upload queue
- `cleanup.js` - 12GB limit management
- `watcher.js` - File monitoring
- `server.js` - New API endpoints
- `driveManager.js` - Google Drive operations (NEW)
- `.env.example` - Configuration template

---

## 💡 Tips

1. **Safe Deletion**: Only uploaded files are deleted during cleanup
2. **Queue Monitoring**: Check queue status to ensure uploads are processing
3. **Folder Naming**: Folders auto-create with proper date structure
4. **Retry Logic**: Failed uploads retry automatically every 5 minutes
5. **Storage Buffer**: Keeps storage at ~90% of limit to ensure smooth operation

---

**Version**: 2.0 (Storage Management)  
**Last Updated**: 2026-04-18
