// server.js — corrected version based on your original file
// All original logic preserved; structural fixes only.

import express from "express";
import { google } from "googleapis";
import * as chrono from "chrono-node";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import crypto from "crypto";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
// Global text cleaner for both user and AI messages
function cleanText(text) {
  // Fix multiple spaces but preserve space after punctuation
  return text
    .replace(/[ ]{2,}/g, ' ')      // collapse multiple spaces
    .replace(/\s+([,.!?])/g, '$1') // remove space before punctuation
    .replace(/([,.!?])(?=[^\s])/g, '$1 ') // ensure space *after* punctuation
    .replace(/\s{2,}/g, ' ')       // collapse again if needed
    .trim();
}



const __dirname = path.resolve();
const credentialsPath = path.join(__dirname, "credentials.json");

const credentials = JSON.parse(fs.readFileSync(credentialsPath));
const { client_secret, client_id, redirect_uris } = credentials.web;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const tokensPath = path.join(__dirname, "tokens.json");
let tokens = null;

if (fs.existsSync(tokensPath)) {
  tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));

  console.log("✅ Tokens loaded from tokens.json");
  console.log("✅ Tokens saved to tokens.json");
} else {
  console.log("⚠️ No tokens.json found — please run OAuth flow first.");
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get("/auth", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
  res.redirect(url);
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing authorization code.");
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.writeFileSync(path.join(__dirname, "tokens.json"), JSON.stringify(tokens, null, 2));
    console.log("✅ Tokens saved to tokens.json");

    console.log("✅ Access Token:", tokens.access_token);
    console.log("✅ Refresh Token:", tokens.refresh_token);
    res.send("Authorization successful! Tokens logged and saved.");
  } catch (err) {
    console.error("Error retrieving tokens:", err);
    res.status(500).send("Failed to retrieve tokens.");
  }
});

const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
const sheets = google.sheets({ version: "v4", auth: oAuth2Client });
const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

function makeSessionId() {
  try {
    return crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
  }
}

async function saveBooking(booking) {
  try {
    // Ensure booking.date is in YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) {
      const parsedDate = chrono.parseDate(booking.date);
      booking.date = parsedDate.toISOString().split("T")[0];
    }

   // Build proper RFC3339 timestamps with timezone
const startDateTime = `${booking.date}T${normalizeTime(booking.startTime || "12:00")}`;
const endDateTime = `${booking.date}T${normalizeTime(booking.endTime || "13:00")}`;

// Ensure valid chronological order: if end <= start, add +1 hour
let start = new Date(startDateTime);
let end = new Date(endDateTime);
if (end <= start) {
  end = new Date(start.getTime() + 60 * 60 * 1000); // +1 hour
}

const event = {
  summary: `Banquet: ${booking.eventType || "Event"}`,
  description: `Customer: ${booking.email}\nGuests: ${booking.partySize}\nFood: ${booking.food}`,
  start: {
    dateTime: start.toISOString(),
    timeZone: "America/New_York",
  },
  end: {
    dateTime: end.toISOString(),
    timeZone: "America/New_York",
  },
};


    // Insert event into Google Calendar
    try {
      console.log("📅 Attempting to create calendar event:", event);

      const res = await calendar.events.insert({
        calendarId: process.env.CALENDAR_ID || "primary",
        resource: event,
      });

      console.log("✅ Event created successfully:", res.data.htmlLink);
    } catch (err) {
      console.error("❌ Calendar insert failed:", err.errors || err.message || err);
    }

    // Append booking details to Google Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: "Bookings!A1",
      valueInputOption: "RAW",
      resource: {
        values: [
          [
            booking.date,
            booking.startTime,
            booking.endTime,
            booking.eventType,
            booking.partySize,
            booking.food,
            booking.email,
            booking.phone,
            booking.decor || "None",
            booking.extras || "None",
          ],
        ],
      },
    });

    console.log("✅ Booking saved successfully!");
  } catch (err) {
    console.error("❌ Google integration error:", err);
    throw err;
  }
}

function normalizeTime(str) {
  if (!str) return "00:00:00";
  let t = str.trim().toLowerCase();
  let hour = 0,
    minute = 0;
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (m) {
    hour = parseInt(m[1]);
    minute = parseInt(m[2] || "0");
    if (m[3] === "pm" && hour < 12) hour += 12;
    if (m[3] === "am" && hour === 12) hour = 0;
  }
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;
}

/*
// Commented out per your original file
async function sendConfirmationEmail(booking) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
    });

    const mailOptions = {
      from: `Salvatore’s Banquet <${process.env.EMAIL_USER}>`,
      to: booking.email,
      subject: "Banquet Booking Confirmation",
      text: `Hello,\n\nYour banquet is confirmed for ${booking.date} from ${booking.startTime}–${booking.endTime}.\n\nEvent: ${booking.eventType}\nGuests: ${booking.partySize}\nFood: ${booking.food}\n\nThank you for choosing Salvatore’s!\n\n— Salvatore’s Howland`,
    };

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("❌ Email error:", err);
  }
}
*/

function streamText(res, sessionId, text, chunkSize = 40) {
  text = cleanText(text);

  try {
    res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
    res.flush?.();
  } catch {}

  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    res.write(`data: ${chunk}\n\n`);
    res.flush?.();
  }

  res.write("data: [DONE]\n\n");
  res.end();
}


async function callOpenAIStream(prompt, onChunk) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    stream: true,
  });
  for await (const chunk of response) {
    let content = chunk.choices?.[0]?.delta?.content;
    if (content) {
      // Send raw content chunks - don't clean individual chunks
      onChunk(content);
    }
  }
}

function makeNewSession() {
  return {
    step: 0,
    booking: {
      date: null,
      startTime: null,
      endTime: null,
      partySize: null,
      eventType: null,
      food: null,
      email: null,
      phone: null,
      decor: null,
      extras: null,
    },
    history: [
      {
        role: "system",
        content:
          "You are Salvatore AI, a polite, friendly banquet-booking assistant. Ask one question at a time. Treat BookingDetails from the server as authoritative.",
      },
    ],
    lastServerPrompt: "",
  };
}

const conversationContext = {};

// -------------------- /api/assistant route --------------------
// IMPORTANT: This route now contains all booking logic, chrono parsing, and OpenAI fallback.
// All variables referenced here (message, session) are local to this route.
app.post("/api/assistant", async (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    let { sessionId, message } = req.body || {};
    message = (message || "").trim();
   // Clean text to fix spacing and common formatting issues
message = cleanText(message);
console.log("🧠 Cleaned user message:", message);


    // If there's no message, close the connection immediately
    if (!message) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // Ensure session exists
    let createdNew = false;
    if (!sessionId) {
      sessionId = makeSessionId();
      createdNew = true;
    }
    if (!conversationContext[sessionId]) {
      conversationContext[sessionId] = makeNewSession();
    }
    const session = conversationContext[sessionId];

    // Parse date/time from user message early when needed (keeps original logic)
    // If a user mentions a date/time in their freeform message we can extract it.
    const results = chrono.parse(message, { forwardDate: true });
    let parsedDate = null;
    let parsedTime = null;

    if (results.length > 0 && results[0].start) {
      let date = results[0].start.date();

      // If year is not mentioned and the parsed date is in the past, assume next year
      const mentionedYear = results[0].start.knownValues.year;
      const now = new Date();
      if (!mentionedYear && date < now) {
        date.setFullYear(now.getFullYear() + 1);
      }

      // Normalize timezone offset for consistent ISO format
      const offset = date.getTimezoneOffset();
      date = new Date(date.getTime() - offset * 60 * 1000);

      parsedDate = date.toISOString().split("T")[0];
      parsedTime = date.toISOString().split("T")[1].slice(0, 5);

      console.log("📅 Parsed final date:", parsedDate, parsedTime);
    } else {
      // Not an error — just informational
      console.warn("⚠️ No valid date detected in user message:", message);
    }

    // Always send sessionId first so the frontend can capture it
    try {
      res.write(`data: ${JSON.stringify({ sessionId })}\n\n`);
      res.flush?.();
    } catch (e) {}

    // Booking intent detector (keeps your original heuristic)
    const lower = message.toLowerCase();
    const isBookingIntent =
      lower.includes("book") ||
      lower.includes("banquet") ||
      lower.includes("reserve") ||
      lower.includes("party") ||
      lower.includes("event");

    // Step prompts (kept from your earlier version)
    const stepPrompts = {
      0: "Hi there! I'm your Salvatore AI assistant — I can help you book a banquet or answer any questions! Would you like to book a banquet or ask a general question?",
      2: "Wonderful — what date would you like to book your banquet for?",
      3: "Got it! What time would you like your event to start (and end), e.g., '6pm' or '6pm-9pm'?",
      4: "Perfect. How many guests are you expecting?",
      5: `Noted. What type of event is this? Options include: 
- Anniversary Party
- Bar/Bat Mitzvah
- Birthday Party
- Business Meeting
- Charity Event
- Corporate Event
- Engagement Party
- Wedding Reception
- Graduation Party
- Holiday Party`,
      6: "Sounds great! What kind of food or catering would you like to have?",
      7: "Excellent — could you please provide a contact email so we can send confirmation?",
      8: "Thanks! And a phone number for quick contact?",
      9: "Got it. Would you like any specific decor or theme for the event?",
      10: "Any other special requests or questions you'd like noted?",
    };

    function ask(stepNum, promptText) {
      session.step = stepNum;
      session.lastServerPrompt = promptText;
      return streamText(res, sessionId, promptText);
    }

    // If currently at initial step 0, handle booking or general question
    if (session.step === 0) {
      if (isBookingIntent) {
        session.step = 2;
        const prompt = stepPrompts[2] || "Wonderful — what date would you like to book your banquet for?";
        session.lastServerPrompt = prompt;
        return streamText(res, sessionId, prompt);
      } else {
        session.step = 1;
        const prompt = stepPrompts[0];
        session.lastServerPrompt = prompt;
        return streamText(res, sessionId, prompt);
      }
    }

    // Step-by-step booking flow (this preserves your original logic)
    if (session.step === 1) {
      if (isBookingIntent) {
        session.step = 2;
        const prompt = stepPrompts[2];
        session.lastServerPrompt = prompt;
        return streamText(res, sessionId, prompt);
      } else {
        // Keep history and respond with assistant placeholder (no external AI called here)
        session.history.push({ role: "user", content: message });
        const built =
          session.history
            .map((m) =>
              m.role === "system"
                ? `System: ${m.content}`
                : m.role === "user"
                ? `User: ${m.content}`
                : `Assistant: ${m.content}`
            )
            .join("\n") + "\nAssistant:";
        session.lastServerPrompt = built;
        // push empty assistant content and close stream
        session.history.push({ role: "assistant", content: "" });
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
    }

    // Use switch to centralize the step handling (keeps everything consistent)
    switch (session.step) {
      case 2:
        // If parsedDate exists from chrono and user didn't give a plain date, prefer parsedDate
        if (!session.booking.date && parsedDate) {
          session.booking.date = parsedDate;
        } else if (!session.booking.date) {
          session.booking.date = message;
        }
        return ask(3, stepPrompts[3]);

      case 3:
        // parse time range like "6pm-9pm" or "6pm to 9pm"
        {
          const timeRangeMatch = message.match(
            /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s*[-to]{1,3}\s*)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
          );
          if (timeRangeMatch) {
            session.booking.startTime = timeRangeMatch[1].trim();
            session.booking.endTime = timeRangeMatch[2].trim();
          } else {
            // If chrono parsed a time and we didn't find explicit range, use parsedTime
            if (parsedTime && !message.match(/\d/)) {
              session.booking.startTime = parsedTime;
            } else {
              session.booking.startTime = message;
            }
          }
          return ask(4, stepPrompts[4]);
        }

      case 4:
        {
          const m = message.match(/(\d{1,4})/);
          if (m) {
            session.booking.partySize = m[1];
          } else {
            session.booking.partySize = message;
          }
          return ask(5, stepPrompts[5]);
        }

      case 5:
        session.booking.eventType = message;
        return ask(6, stepPrompts[6]);

      case 6:
        session.booking.food = message;
        return ask(7, stepPrompts[7]);

      case 7:
        {
          const emailMatch = message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
          session.booking.email = emailMatch ? emailMatch[0] : message;
          return ask(8, stepPrompts[8]);
        }

      case 8:
        {
          const phoneMatch = message.match(/(\+?\d[\d\-\s()]{6,}\d)/);
          session.booking.phone = phoneMatch ? phoneMatch[0] : message;
          return ask(9, stepPrompts[9]);
        }

      case 9:
        session.booking.decor = message;
        return ask(10, stepPrompts[10]);

      case 10:
        {
          const low = message.toLowerCase();
          if (low.includes("no") || low.includes("that's it") || low.includes("thats it") || low.includes("nope")) {
            const summary = [
              `📅 Date: ${session.booking.date || "TBD"}`,
              `⏰ Time: ${session.booking.startTime || "TBD"}${session.booking.endTime ? " - " + session.booking.endTime : ""}`,
              `👥 Guests: ${session.booking.partySize || "TBD"}`,
              `🎉 Event Type: ${session.booking.eventType || "TBD"}`,
              `🍽 Food: ${session.booking.food || "TBD"}`,
              `📧 Email: ${session.booking.email || "TBD"}`,
              `📞 Phone: ${session.booking.phone || "TBD"}`,
              `🎈 Decor: ${session.booking.decor || "None"}`
            ].join("\n");

            const confirmMsg = `Thanks — here's a summary of your booking:\n\n${summary}\n\nWe'll follow up to confirm. For immediate help call 330.422.3304 or email salvatoresHowland@gmail.com.`;

            // Save to Google Calendar & Sheets
            try {
              await saveBooking(session.booking);
            } catch (err) {
              console.error("Error saving booking during final step:", err);
            }

            // Reset conversation state for that session
            conversationContext[sessionId] = makeNewSession();
            conversationContext[sessionId].history[0] = {
              role: "system",
              content:
                "You are Salvatore AI, a polite, friendly banquet-booking assistant. Ask one question at a time. Treat BookingDetails from the server as authoritative.",
            };

            return streamText(res, sessionId, confirmMsg);
          } else {
            // user provided extras
            session.booking.extras = message;
            const confirmMsg = `Noted. I've added: "${message}". We'll include that in your booking. We'll follow up to confirm. For immediate help call 330.422.3304 or email salvatoresHowland@gmail.com.`;
            // Reset session
            conversationContext[sessionId] = makeNewSession();
            return streamText(res, sessionId, confirmMsg);
          }
        }

      default:
        // If none of the above booking steps matched, fall through to AI fallback.
        break;
    }

    // If we reach here, we treat the input as general AI chat:
    // Build prompt from session history (preserve your original formatting)
    const prompt =
      session.history
        .map((m) =>
          m.role === "system"
            ? `System: ${m.content}`
            : m.role === "user"
            ? `User: ${m.content}`
            : `Assistant: ${m.content}`
        )
        .join("\n") + "\nAssistant:";

    session.lastServerPrompt = prompt;

    try {
      // Stream AI response to client
      await callOpenAIStream(prompt, (chunk) => {
        res.write(`data: ${chunk}\n\n`);
        res.flush?.();
      });

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e) {
      console.error("OpenAI stream error:", e);
      try {
        res.write("data: Sorry — AI backend error. Try again later.\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
      } catch (err) {
        console.error("Error writing error response:", err);
      }
    }
  } catch (err) {
    console.error("🔥 Error in /api/assistant route:", err);
    try {
      res.write("data: [ERROR in assistant]\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      // swallow
    }
  }
});

// -------------------- Start server --------------------
app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));
