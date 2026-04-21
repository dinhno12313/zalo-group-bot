require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

app.get("/", (req, res) => {
  res.send("Zalo AI Bot is running");
});

async function sendZaloMessage(chatId, text) {
  const url = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: String(chatId),
    text,
  };

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
  });

  console.log("sendMessage:", response.data);
}

async function askGemini(userText) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: userText,
    config: {
      systemInstruction:
        "Bạn là trợ lý AI trả lời bằng tiếng Việt, ngắn gọn, rõ ràng, hữu ích.",
    },
  });

  return response.text || "Mình chưa có câu trả lời phù hợp.";
}

app.post("/zalo-bot/webhook", async (req, res) => {
  try {
    const secret = req.header("X-Bot-Api-Secret-Token");
    if (secret !== BOT_WEBHOOK_SECRET) {
      return res.status(403).json({ ok: false, message: "Unauthorized" });
    }

    const eventName = req.body?.event_name || "";
    const text = req.body?.message?.text || "";
    const chatId = req.body?.message?.chat?.id || null;
    const isBot = req.body?.message?.from?.is_bot || false;

    if (isBot) {
      return res.status(200).json({ ok: true });
    }

    if (eventName !== "message.text.received" || !chatId || !text) {
      return res.status(200).json({ ok: true });
    }

    if (text.trim().toLowerCase() === "#ping") {
      await sendZaloMessage(chatId, "pong");
      return res.status(200).json({ ok: true });
    }

    const answer = await askGemini(text);
    await sendZaloMessage(chatId, answer);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message || err);
    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});