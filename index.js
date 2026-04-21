require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_WEBHOOK_SECRET = process.env.BOT_WEBHOOK_SECRET;

app.get("/", (req, res) => {
  res.send("Zalo Bot server is running");
});

app.post("/zalo-bot/webhook", (req, res) => {
  try {
    const secret = req.header("X-Bot-Api-Secret-Token");

    if (secret !== BOT_WEBHOOK_SECRET) {
      console.log("Invalid webhook secret");
      return res.status(401).json({ ok: false });
    }

    console.log("Bot webhook body:", JSON.stringify(req.body, null, 2));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});