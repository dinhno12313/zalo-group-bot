require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ===== Basic validation =====
if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN in environment variables.");
}
if (!BOT_WEBHOOK_SECRET) {
  throw new Error("Missing BOT_WEBHOOK_SECRET in environment variables.");
}
if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY in environment variables.");
}

// Google GenAI SDK for Gemini API
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ===== Simple in-memory chat history =====
// Lưu tạm trong RAM, mất khi redeploy/restart.
const chatMemory = new Map();
const MAX_HISTORY_PER_CHAT = 10;
const MAX_INPUT_LENGTH = 2000;
const MAX_OUTPUT_LENGTH = 1200;

// ===== Config =====
const GEMINI_MODEL = "gemini-3-flash";
const SYSTEM_PROMPT = `
Bạn là trợ lý AI trên Zalo.
Trả lời bằng tiếng Việt, rõ ràng, tự nhiên, hữu ích.
Ưu tiên ngắn gọn nhưng đủ ý.
Nếu câu hỏi mơ hồ, hãy hỏi lại ngắn gọn.
Không bịa thông tin. Nếu không chắc, nói rõ là không chắc.
Không dùng markdown phức tạp.
`.trim();

// ===== Helpers =====
function truncateText(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function normalizeText(text) {
  return String(text || "").trim();
}

function isCommand(text) {
  return normalizeText(text).startsWith("#");
}

function getHelpText() {
  return [
    "Menu bot:",
    "#ping - kiểm tra bot",
    "#help - xem hướng dẫn",
    "#reset - xóa ngữ cảnh cuộc trò chuyện",
    "",
    "Bạn cũng có thể nhắn tin bình thường để hỏi AI.",
  ].join("\n");
}

function getChatHistory(chatId) {
  if (!chatMemory.has(chatId)) {
    chatMemory.set(chatId, []);
  }
  return chatMemory.get(chatId);
}

function pushHistory(chatId, role, text) {
  const history = getChatHistory(chatId);
  history.push({ role, text, ts: Date.now() });

  if (history.length > MAX_HISTORY_PER_CHAT) {
    history.splice(0, history.length - MAX_HISTORY_PER_CHAT);
  }
}

function clearHistory(chatId) {
  chatMemory.delete(chatId);
}

function buildContentsFromHistory(history, userText) {
  const contents = [];

  for (const item of history) {
    if (!item.text) continue;
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.text }],
    });
  }

  contents.push({
    role: "user",
    parts: [{ text: userText }],
  });

  return contents;
}

async function sendZaloMessage(chatId, text) {
  const url = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: String(chatId),
    text: truncateText(text, MAX_OUTPUT_LENGTH),
  };

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  return response.data;
}

async function askGemini(chatId, userText) {
  const history = getChatHistory(chatId);
  const contents = buildContentsFromHistory(history, userText);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.7,
    },
  });

  const answer = normalizeText(response.text);

  if (!answer) {
    return "Mình chưa tạo được câu trả lời phù hợp. Bạn thử hỏi lại ngắn gọn hơn nhé.";
  }

  return truncateText(answer, MAX_OUTPUT_LENGTH);
}

async function handleCommand(chatId, text) {
  const cmd = normalizeText(text).toLowerCase();

  if (cmd === "#ping") {
    return "pong";
  }

  if (cmd === "#help") {
    return getHelpText();
  }

  if (cmd === "#reset") {
    clearHistory(chatId);
    return "Đã xóa ngữ cảnh cuộc trò chuyện.";
  }

  return "Lệnh không hợp lệ. Gõ #help để xem danh sách lệnh.";
}

// ===== Routes =====
app.get("/", (req, res) => {
  res.send("Zalo AI Bot is running");
});

app.post("/zalo-bot/webhook", async (req, res) => {
  try {
    const secret = req.header("X-Bot-Api-Secret-Token");
    if (secret !== BOT_WEBHOOK_SECRET) {
      return res.status(403).json({ ok: false, message: "Unauthorized" });
    }

    const eventName = req.body?.event_name || "";
    const message = req.body?.message || {};

    const chatId = message?.chat?.id || null;
    const text = normalizeText(message?.text || "");
    const isBot = Boolean(message?.from?.is_bot);

    // Trả 200 sớm cho event không cần xử lý
    if (eventName !== "message.text.received") {
      return res.status(200).json({ ok: true, skipped: "unsupported_event" });
    }

    if (!chatId || !text) {
      return res.status(200).json({ ok: true, skipped: "missing_chat_or_text" });
    }

    // Chặn loop bot tự trả lời chính nó
    if (isBot) {
      return res.status(200).json({ ok: true, skipped: "bot_message" });
    }

    const safeUserText = truncateText(text, MAX_INPUT_LENGTH);
    let replyText = "";

    if (isCommand(safeUserText)) {
      replyText = await handleCommand(chatId, safeUserText);
    } else {
      replyText = await askGemini(chatId, safeUserText);

      // Chỉ lưu lịch sử cho tin nhắn AI chat thường
      pushHistory(chatId, "user", safeUserText);
      pushHistory(chatId, "assistant", replyText);
    }

    await sendZaloMessage(chatId, replyText);

    console.log(
      JSON.stringify({
        event: eventName,
        chatId,
        textPreview: truncateText(safeUserText, 80),
        replied: true,
      })
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(
      "Webhook error:",
      error?.response?.data || error?.message || error
    );

    // Cố gắng gửi fallback nếu còn lấy được chatId
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        await sendZaloMessage(
          chatId,
          "Mình đang bận một chút hoặc AI tạm lỗi. Bạn thử lại sau nhé."
        );
      }
    } catch (fallbackError) {
      console.error(
        "Fallback send error:",
        fallbackError?.response?.data || fallbackError?.message || fallbackError
      );
    }

    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});