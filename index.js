require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET;

app.get("/", (req, res) => {
  res.send("Zalo Bot server is running");
});

function getReply(text) {
  const t = (text || "").trim().toLowerCase();

  if (t === "#ping") return "pong";
  if (t === "#help") {
    return `Menu bot:
#ping - test bot
#help - xem menu
#rule - nội quy nhóm`;
  }
  if (t === "#rule") {
    return "Nội quy: không spam, không toxic, không đăng nội dung vi phạm.";
  }

  return null;
}

async function sendMessage(chatId, text) {
  try {
    const url = `https://bot-api.zaloplatforms.com/bot${BOT_TOKEN}/sendMessage`;

    const payload = {
      chat_id: String(chatId),
      text: text,
    };

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log("sendMessage success:", JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error(
      "sendMessage error:",
      error.response ? error.response.data : error.message
    );
    throw error;
  }
}

app.post("/zalo-bot/webhook", async (req, res) => {
  try {
    const secret = req.header("X-Bot-Api-Secret-Token");

    console.log("received secret =", secret);
    console.log("expected secret =", BOT_WEBHOOK_SECRET);

    if (secret !== BOT_WEBHOOK_SECRET) {
      console.log("Invalid webhook secret");
      return res.status(403).json({ ok: false, message: "Unauthorized" });
    }

    console.log("=== FULL WEBHOOK BODY ===");
    console.log(JSON.stringify(req.body, null, 2));

    const eventName = req.body?.event_name || "";
    const text = req.body?.message?.text || "";
    const chatId = req.body?.message?.chat?.id || null;
    const messageId = req.body?.message?.message_id || null;

    console.log("eventName =", eventName);
    console.log("text =", text);
    console.log("chatId =", chatId);
    console.log("messageId =", messageId);

    if (eventName === "message.text.received") {
      const reply = getReply(text);

      if (reply && chatId) {
        await sendMessage(chatId, reply);
      } else {
        console.log("No reply matched");
      }
    } else {
      console.log("Skip event:", eventName);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(
      "Webhook error:",
      err.response ? err.response.data : err.message
    );
    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});