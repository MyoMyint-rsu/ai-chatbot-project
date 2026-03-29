import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


const PORT = process.env.PORT || 10000;

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS faq_items (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      keywords TEXT NOT NULL,
      category VARCHAR(100),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id VARCHAR(255),
      user_message TEXT NOT NULL,
      bot_reply TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS answer_source VARCHAR(50)
  `);

  console.log("Database ready");
}

async function findFAQ(message) {
  const text = message.toLowerCase();

  const result = await pool.query(`
    SELECT id, question, answer, keywords, category
    FROM faq_items
    WHERE is_active = TRUE
    ORDER BY id ASC
  `);

  for (const row of result.rows) {
    const keywords = row.keywords
      .split(",")
      .map(k => k.trim().toLowerCase());

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return row;
      }
    }
  }

  return null;
}

app.get("/api/faq", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, question, answer, keywords, category, is_active, created_at
      FROM faq_items
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("FAQ fetch error:", error);
    res.status(500).json({ error: "Failed to fetch FAQ data." });
  }
});

app.post("/api/faq", async (req, res) => {
  try {
    const { question, answer, keywords, category } = req.body;

    if (!question || !answer || !keywords) {
      return res.status(400).json({
        error: "question, answer, and keywords are required."
      });
    }

    const result = await pool.query(
      `
      INSERT INTO faq_items (question, answer, keywords, category)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [question, answer, keywords, category || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("FAQ insert error:", error);
    res.status(500).json({ error: "Failed to insert FAQ data." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    let reply = "";
    let source = "";

    const faqMatch = await findFAQ(message);

    if (faqMatch) {
      reply = faqMatch.answer;
      source = "database";
      } else {
      const systemPrompt = `
You are a helpful AI assistant for a local T-shirt shop.

If the user asks a general question, answer clearly and politely.
If exact business information is not available in the knowledge base, do not invent details.
      `;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.FRONTEND_URL || "",
          "X-OpenRouter-Title": "AI FAQ Chatbot"
        },
        body: JSON.stringify({
          model: "openrouter/auto",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "OpenRouter request failed");
      }

      reply =
        data?.choices?.[0]?.message?.content ||
        "Sorry, I could not generate a response.";

      source = "openrouter";
    }

    await pool.query(
      `
      INSERT INTO chat_messages (session_id, user_message, bot_reply, answer_source)
      VALUES ($1, $2, $3, $4)
      `,
      [sessionId || "anonymous", message, reply, source]
    );

    res.json({ reply, source });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      error: err.message || "Chat failed"
    });
  }
});

app.listen(PORT, async () => {
  await createTables();
  console.log("Server running");
});
