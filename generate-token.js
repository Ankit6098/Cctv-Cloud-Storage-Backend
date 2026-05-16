const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
];
const TOKEN_PATH = path.join(__dirname, "token.json");
const CREDENTIALS_PATH = path.join(__dirname, "oauth-credentials.json");

async function generateToken() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`Error: ${CREDENTIALS_PATH} not found.`);
    console.log("Please download your OAuth client credentials from Google Cloud Console.");
    return;
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  console.log("\n============================================================");
  console.log("Please authenticate by visiting this URL in any web browser:");
  console.log("\n" + authUrl + "\n");
  console.log("============================================================\n");
  console.log("Waiting for authorization (the browser will redirect back to this terminal)...");

  // Start a temporary HTTP server to receive the redirect
  const redirectUrl = new url.URL(redirect_uris[0]);
  const port = redirectUrl.port || 3000;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new url.URL(req.url, `http://localhost:${port}`);
      const code = reqUrl.searchParams.get("code");
      
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end("<h1>Authentication successful!</h1><p>You can close this window and return to the terminal.</p>");
        server.close();
        
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        const tokenToSave = {
          ...tokens,
          client_id: client_id,
          client_secret: client_secret,
          redirect_uris: redirect_uris
        };
        
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenToSave, null, 2));
        console.log("✓ Token successfully generated and saved to token.json!");
        process.exit(0);
      } else if (reqUrl.pathname === '/') {
        res.end("Waiting for code...");
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end("Authentication failed: " + err.message);
      console.error("Error getting token:", err);
      server.close();
      process.exit(1);
    }
  }).listen(port, () => {
    // Silent
  });
}

generateToken();
