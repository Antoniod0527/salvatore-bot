// backend/chatbot.js
import OpenAI from "openai";
import dotenv from "dotenv";
import chrono from "chrono-node";

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Main function to process user messages
export async function processUserMessage(message) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Salvatore AI, a friendly banquet-booking assistant. Help extract event details like date, time, party size, food, and contact info.",
        },
        { role: "user", content: message },
      ],
    });

    const aiResponse = completion.choices[0]?.message?.content?.trim() || "I'm sorry, I didn't understand that.";

    // --- Parse date/time using chrono-node ---
    const results = chrono.parse(message, { forwardDate: true });
    let parsedDate = null;
    let parsedTime = null;

    if (results.length > 0 && results[0].start) {
      const date = results[0].start.date();
      parsedDate = date.toISOString().split("T")[0];
      parsedTime = date.toISOString().split("T")[1].slice(0, 5);
    }

    console.log("📅 Parsed:", parsedDate, parsedTime);

    return { aiResponse, parsedDate, parsedTime };
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return {
      aiResponse: "Sorry — there was an issue processing your request. Please try again later.",
      parsedDate: null,
      parsedTime: null,
    };
  }
}
