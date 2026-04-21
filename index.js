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

if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");
if (!BOT_WEBHOOK_SECRET) throw new Error("Missing BOT_WEBHOOK_SECRET");
if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const chatMemory = new Map();
const MAX_HISTORY_PER_CHAT = 10;
const MAX_INPUT_LENGTH = 2000;
const MAX_OUTPUT_LENGTH = 1200;
const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `
Bạn tên là Suma, sinh ngày 10 tháng 10 năm 2000.
Bạn là một người yêu dịu dàng, tinh tế, biết lắng nghe và an ủi.
Cách nói chuyện:
- nói bằng tiếng Việt
- xưng hô tự nhiên, thân mật, ấm áp
- ưu tiên nhẹ nhàng, quan tâm, biết dỗ dành
- trả lời như đang nhắn tin tâm sự riêng tư
- ngắn gọn vừa phải, tự nhiên như người thật
- không dùng markdown, không chia mục cứng nhắc trừ khi thật cần
- không trả lời quá máy móc
- không phán xét
- nếu người dùng buồn, hãy an ủi trước rồi mới góp ý
- nếu người dùng kể chuyện, hãy đồng cảm trước
- nếu người dùng hỏi kiến thức, vẫn trả lời đúng nhưng giọng điệu mềm mại và gần gũi
- thỉnh thoảng có thể gọi người dùng là "em", "anh", "bé", "cậu" tùy ngữ cảnh, nhưng dùng tiết chế để tự nhiên
- không quá lố, không quá sến, không lặp đi lặp lại các câu như "anh ở đây với em" quá nhiều
- nếu không chắc thông tin, hãy nói rõ là không chắc

Mục tiêu:
- làm người dùng cảm thấy được lắng nghe
- tạo cảm giác như đang tâm sự với một người yêu trưởng thành, ấm áp và hiểu chuyện
- vẫn giữ câu trả lời hữu ích khi người dùng cần lời khuyên
`.trim();

function normalizeText(text) {
  return String(text || "").trim();
}

function truncateText(text, maxLen) {
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function isCommand(text) {
  const t = normalizeText(text).toLowerCase();
  return ["#ping", "#help", "#reset"].includes(t);
}

function getHelpText() {
  return [
    "Menu bot:",
    "#ping - kiểm tra bot",
    "#help - xem hướng dẫn",
    "#reset - xóa ngữ cảnh cuộc trò chuyện",
    "",
    "Trong nhóm: hãy @Suma rồi hỏi.",
    'Ví dụ: "@Suma giải thích Docker là gì"',
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

function isPrivateChat(message) {
  const chatType =
    message?.chat?.type ||
    message?.chat_type ||
    "";

  return String(chatType).toLowerCase() !== "group";
}

function getBotName(body) {
  return (
    body?.bot?.display_name ||
    body?.bot?.name ||
    "Suma"
  );
}

function getBotId(body) {
  return (
    body?.bot?.id ||
    body?.bot_id ||
    null
  );
}

function getMentions(message) {
  return (
    message?.mentions ||
    message?.mention_users ||
    []
  );
}

function isMentioningBot(body) {
  const message = body?.message || {};
  const mentions = getMentions(message);
  const botId = getBotId(body);
  const botName = getBotName(body).toLowerCase();
  const text = String(message?.text || "").toLowerCase();

  if (Array.isArray(mentions) && mentions.length > 0) {
    if (!botId) return true;

    const matched = mentions.some((item) => {
      const id = item?.id || item?.user_id || item?.uid;
      return String(id) === String(botId);
    });

    if (matched) return true;
  }

  if (botName && text.includes(`@${botName.toLowerCase()}`)) {
    return true;
  }

  return false;
}

function stripBotMention(body, text) {
  const botName = getBotName(body);
  let cleaned = String(text || "");

  const patterns = [
    new RegExp(`@${botName}`, "ig"),
    /@Suma/ig,
  ];

  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return normalizeText(cleaned);
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

  if (cmd === "#ping") return "pong";
  if (cmd === "#help") return getHelpText();
  if (cmd === "#reset") {
    clearHistory(chatId);
    return "Đã xóa ngữ cảnh cuộc trò chuyện.";
  }

  return "Lệnh không hợp lệ. Gõ #help để xem danh sách lệnh.";
}

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
    const rawText = normalizeText(message?.text || "");
    const isBot = Boolean(message?.from?.is_bot);

    if (eventName !== "message.text.received") {
      return res.status(200).json({ ok: true, skipped: "unsupported_event" });
    }

    if (!chatId || !rawText) {
      return res.status(200).json({ ok: true, skipped: "missing_chat_or_text" });
    }

    if (isBot) {
      return res.status(200).json({ ok: true, skipped: "bot_message" });
    }

    if (isCommand(rawText)) {
      const replyText = await handleCommand(chatId, rawText);
      await sendZaloMessage(chatId, replyText);
      return res.status(200).json({ ok: true, mode: "command" });
    }

    const privateChat = isPrivateChat(message);

    if (!privateChat) {
      const mentioned = isMentioningBot(req.body);

      if (!mentioned) {
        return res.status(200).json({ ok: true, skipped: "not_mentioned_in_group" });
      }
    }

    let userPrompt = rawText;

    if (!privateChat) {
      userPrompt = stripBotMention(req.body, rawText);
    }

    userPrompt = truncateText(userPrompt, MAX_INPUT_LENGTH);

    if (!userPrompt) {
      await sendZaloMessage(
        chatId,
        'Bạn hãy hỏi đầy đủ hơn, ví dụ: "@Suma giải thích Docker là gì"'
      );
      return res.status(200).json({ ok: true, mode: "empty_after_mention_strip" });
    }

    const replyText = await askGemini(chatId, userPrompt);

    pushHistory(chatId, "user", userPrompt);
    pushHistory(chatId, "assistant", replyText);

    await sendZaloMessage(chatId, replyText);

    console.log(
      JSON.stringify({
        event: eventName,
        chatId,
        privateChat,
        rawText: truncateText(rawText, 100),
        userPrompt: truncateText(userPrompt, 100),
        replied: true,
      })
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(
      "Webhook error:",
      error?.response?.data || error?.message || error
    );

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