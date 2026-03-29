import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
      answer_source VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default FAQ if empty
  const check = await pool.query(`SELECT COUNT(*) FROM faq_items`);
  if (parseInt(check.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO faq_items (question, answer, keywords, category)
      VALUES
      ('What sizes do you have?', 'We offer sizes S, M, L, XL, XXL.', 'size,sizes,tshirt size', 'product'),
      ('How long does delivery take?', 'Delivery takes 3-5 business days.', 'delivery,shipping,time', 'delivery'),
      ('Can I customize my T-shirt?', 'Yes, customization is available.', 'customize,custom design', 'customization'),
      ('What payment methods do you accept?', 'We accept COD, bank transfer, and online payment.', 'payment,pay', 'payment'),
      ('What is your return policy?', 'Returns allowed within 7 days.', 'return,refund,exchange', 'returns')
    `);
  }

  console.log("Database ready");
}

async function findFAQ(message) {
  const text = message.toLowerCase();

  const result = await pool.query(`SELECT * FROM faq_items`);

  for (const row of result.rows) {
    const keywords = row.keywords.split(",").map(k => k.trim());

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return row.answer;
      }
    }
  }

  return null;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    let reply = "";
    let source = "";

    const faq = await findFAQ(message);

    if (faq) {
      reply = faq;
      source = "database";
    } else {
      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: message
      });

      reply = response.text || "No response";
      source = "gemini";
    }

    await pool.query(
      `INSERT INTO chat_messages (session_id, user_message, bot_reply, answer_source)
       VALUES ($1, $2, $3, $4)`,
      ["user", message, reply, source]
    );

    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat failed" });
  }
});

app.listen(PORT, async () => {
  await createTables();
  console.log("Server running");
});
