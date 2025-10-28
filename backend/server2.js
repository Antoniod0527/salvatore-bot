// ---------- IMPORTS ----------
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import OpenAI from "openai";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

// ---------- SETUP ----------
dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- SESSION DIRECTORY ----------
const sessionsDir = path.resolve("./sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// ---------- GOOGLE SETUP ----------
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set credentials using refresh token
auth.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });

// ---------- HELPERS ----------
function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeTime(t) {
  if (!t) return "12:00:00";
  t = t.toLowerCase().replace(/\s/g, "");
  const match = t.match(/(\d{1,2})(:(\d{2}))?(am|pm)?/);
  if (!match) return "12:00:00";
  let hour = parseInt(match[1]);
  const min = match[3] ? parseInt(match[3]) : 0;
  const period = match[4];
  if (period === "pm" && hour < 12) hour += 12;
  if (period === "am" && hour === 12) hour = 0;
  return `${hour.toString().padStart(2, "0")}:${min
    .toString()
    .padStart(2, "0")}:00`;
}

// ---------- BOOKING EXTRACTION ----------
async function extractBookingDetails(history) {
  try {
    // Build conversation context - only recent messages
    const recentHistory = history.slice(-15);
    const conversationText = recentHistory
      .map((m) => `${m.sender}: ${m.text}`)
      .join("\n");

    console.log("🔍 Extracting from conversation...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You extract booking details from conversations. Return ONLY valid JSON, no other text.`,
        },
        {
          role: "user",
          content: `Extract booking information from this conversation:

${conversationText}

Return JSON in this exact format:
{
  "date": "2025-11-01",
  "startTime": "2:00 PM",
  "endTime": "5:00 PM",
  "partySize": 25,
  "eventType": "Graduation Party",
  "food": "pasta and pizza",
  "email": "antoniod4421@gmail.com",
  "phone": "330-502-9339",
  "notes": ""
}

Rules:
- date must be YYYY-MM-DD format
- times in 12-hour format with AM/PM
- partySize as a number
- Use null for any missing fields
- Return ONLY the JSON object

Extract the data now:`,
        },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      console.log("⚠️ No content from extraction");
      return null;
    }

    // Clean up potential markdown formatting
    const jsonText = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);
    
    console.log("📋 Extracted data:", JSON.stringify(parsed, null, 2));
    
    // Check if we have ALL required fields
    const hasRequired = parsed.date && 
                       parsed.startTime && 
                       parsed.partySize && 
                       parsed.email &&
                       parsed.eventType;
    
    if (hasRequired) {
      console.log("✅ All required fields present!");
      return parsed;
    } else {
      console.log("⚠️ Missing required fields:", {
        date: !!parsed.date,
        startTime: !!parsed.startTime,
        partySize: !!parsed.partySize,
        email: !!parsed.email,
        eventType: !!parsed.eventType
      });
      return null;
    }
  } catch (err) {
    console.error("❌ Booking extraction error:", err.message);
    if (err.response) {
      console.error("API Response:", err.response.data);
    }
    return null;
  }
}

// ---------- SAVE BOOKING TO GOOGLE ----------
async function saveBooking(booking) {
  try {
    // Add to Google Calendar
    const event = {
      summary: `Banquet: ${booking.eventType || "Event"} - ${booking.partySize} guests`,
      description: `Customer: ${booking.email}\nPhone: ${booking.phone || "N/A"}\nGuests: ${booking.partySize}\nFood: ${booking.food || "Not specified"}\nNotes: ${booking.notes || "None"}`,
      start: {
        dateTime: `${booking.date}T${normalizeTime(booking.startTime)}`,
        timeZone: "America/New_York",
      },
      end: {
        dateTime: `${booking.date}T${normalizeTime(booking.endTime || booking.startTime)}`,
        timeZone: "America/New_York",
      },
      attendees: [{ email: booking.email }],
    };

    const calendarId = process.env.CALENDAR_ID || "primary";
    
    await calendar.events.insert({
      calendarId: calendarId,
      requestBody: event,
      sendUpdates: "all",
    });

    console.log("📅 Event added to calendar:", calendarId);

    // Add to Google Sheets
    const sheetId = process.env.SHEET_ID;
    if (sheetId) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: "Bookings!A:I",
        valueInputOption: "RAW",
        requestBody: {
          values: [
            [
              new Date().toISOString(),
              booking.date,
              booking.startTime,
              booking.endTime || "N/A",
              booking.partySize,
              booking.eventType || "N/A",
              booking.food || "N/A",
              booking.email,
              booking.phone || "N/A",
              booking.notes || "",
            ],
          ],
        },
      });
      console.log("📊 Booking added to Google Sheets");
    }

    console.log("✅ Booking saved successfully!");
    return true;
  } catch (err) {
    console.error("❌ Failed to save booking:", err.message);
    console.error("Full error:", err);
    return false;
  }
}

// ---------- MAIN API ENDPOINT ----------
app.post("/api/assistant", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });

    const sid = sessionId || uuidv4();
    const cleanMessage = cleanText(message);
    console.log("🧠 User:", cleanMessage);

    const filePath = `./sessions/${sid}.json`;
    let history = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath))
      : [];

    history.push({ sender: "user", text: cleanMessage });

    // Set headers for SSE streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Send sessionId as separate event (won't show in chat)
    res.write(`data: {"sessionId":"${sid}"}\n\n`);

    // --- AI REPLY WITH STREAMING ---
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are Salvatore's banquet assistant 🍷.
Be friendly, warm, and conversational - like a real Italian restaurant host.
Ask for booking details naturally, one or two questions at a time:
- What type of event? (wedding, birthday, corporate, etc.)
- What date?
- What time?
- How many guests?
- Any food preferences or menu requests?
- Email address for confirmation
- Phone number

Once you have ALL the details, say something like: "Perfect! Let me confirm your booking..." and summarize everything.
Keep your tone natural, warm, and human. Use Italian expressions occasionally like "Perfetto!" or "Magnifico!"`,
        },
        ...history.map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text,
        })),
      ],
      stream: true,
    });

    let botReply = "";

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        botReply += content;
        // Send with proper SSE format - escape newlines and quotes
        const safe = content.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        res.write(`data: ${safe}\n\n`);
      }
    }

    // Save to history
    history.push({ sender: "assistant", text: botReply });
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));

    // --- EXTRACT BOOKING ---
    console.log("🔍 Checking if booking is complete...");
    const booking = await extractBookingDetails(history);
    if (booking) {
      console.log("✅ Attempting to save booking:", JSON.stringify(booking, null, 2));
      const saved = await saveBooking(booking);
      if (saved) {
        console.log("💾 Booking successfully saved!");
        res.write(`data: [BOOKING_SAVED]\n\n`);
      } else {
        console.log("❌ Failed to save booking");
      }
    } else {
      console.log("⏳ Not enough information yet for booking");
    }

    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    console.error("🔥 Error in /api/assistant:", err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
