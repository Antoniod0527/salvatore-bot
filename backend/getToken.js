import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

// Load client secrets from credentials.json
const CREDENTIALS_PATH = "credentials.json";
const TOKEN_PATH = "tokens.json";

function authorize() {
  const content = fs.readFileSync(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = JSON.parse(content).web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  getAccessToken(oAuth2Client);
}

function getAccessToken(oAuth2Client) {
  const SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.send",
  ];

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });

  console.log("Authorize this app by visiting this URL:\n", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("\nEnter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log("✅ Token stored to", TOKEN_PATH);
    });
  });
}

authorize();
