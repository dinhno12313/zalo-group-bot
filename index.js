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
  if (t === "#help") return "Menu:\n#ping\n#help\n#rule";
  if (t === "#rule") return "Nội quy: không spam, không toxic.";
  return null;
}

async function sendMessage(chatId, text) {
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

  console.log("sendMessage response:", JSON.stringify(response.data, null, 2));
  return response.data;
}

app.post("/zalo-bot/webhook", async (req, res) => {
  try {
    const secret = req.header("X-Bot-Api-Secret-Token");

    if (secret !== BOT_WEBHOOK_SECRET) {
      console.log("Invalid webhook secret:", secret);
      return res.status(403).json({ ok: false, message: "Unauthorized" });
    }

    console.log("=== FULL WEBHOOK BODY ===");
    console.log(JSON.stringify(req.body, null, 2));

    const data = req.body?.result || {};

    // thử các vị trí phổ biến
    const text =
      data?.message?.text ||
      data?.text ||
      "";

    const chatId =
      data?.message?.chat?.id ||
      data?.chat?.id ||
      null;

    console.log("parsed text =", text);
    console.log("parsed chatId =", chatId);

    const reply = getReply(text);

    if (reply && chatId) {
      await sendMessage(chatId, reply);
    } else {
      console.log("No reply sent. reply =", reply, "chatId =", chatId);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(
      "Webhook error:",
      err.response?.data || err.message || err
    );
    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});