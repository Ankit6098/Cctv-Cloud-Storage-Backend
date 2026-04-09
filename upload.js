const { google } = require("googleapis");
const fs = require("fs");

const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const uploadFile = async (filePath) => {
  const driveId = process.env.SHARED_DRIVE_ID || "YOUR_SHARED_DRIVE_ID";

  if (driveId === "YOUR_SHARED_DRIVE_ID") {
    console.log(
      "Shared drive ID not configured. Skipping upload to Google Drive.",
    );
    return;
  }

  const drive = google.drive({
    version: "v3",
    auth: await auth.getClient(),
  });

  const response = await drive.files.create({
    requestBody: {
      name: filePath.split("/").pop(),
    },
    media: {
      body: fs.createReadStream(filePath),
    },
    driveId: driveId,
    supportsAllDrives: true,
  });

  console.log("Uploaded:", response.data.id);
};

module.exports = uploadFile;
