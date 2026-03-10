import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { pool } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const allowedOrigin = process.env.FRONTEND_URL || "*";

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const SYSTEM_PROMPT = `
You are an AI FAQ assistant for a local T-shirt shop.
Answer clearly, briefly, and politely.

You can help with:
- product sizes
- delivery
- customization
- payment
- returns
- order support

If the question is outside the T-shirt shop FAQ scope, say:
"This question should be escalated to staff for manual support."

Do not invent fake store policies.
Keep answers easy for customers to understand.
`;

app.get("/", (req, res) => {
  res.json({ message: "Backend is running." });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Database connection failed" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const prompt = `${SYSTEM_PROMPT}\n\nCustomer question: ${message}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt
    });

    const reply = response.text || "Sorry, I could not generate a response.";

    await pool.query(
      `
      INSERT INTO chat_messages (session_id, user_message, bot_reply)
      VALUES ($1, $2, $3)
      `,
      [sessionId || "anonymous", message, reply]
    );

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Failed to get response from Gemini."
    });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, session_id, user_message, bot_reply, created_at
      FROM chat_messages
      ORDER BY created_at DESC
      LIMIT 20
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Logs error:", error);
    res.status(500).json({ error: "Failed to fetch logs." });
  }
});

async function createTableIfNotExists() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        user_message TEXT NOT NULL,
        bot_reply TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("chat_messages table is ready.");
  } catch (error) {
    console.error("Failed to create table:", error);
  }
}

async function startServer() {
  await createTableIfNotExists();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
