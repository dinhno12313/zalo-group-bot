require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.ZALO_OA_ACCESS_TOKEN;

app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);

});

// test route
app.get("/", (req, res) => {
  res.send("Zalo bot server is running");
});

// webhook route
app.post("/zalo/webhook", async (req, res) => {
  try {
    console.log("Webhook body:", JSON.stringify(req.body, null, 2));

    // tạm thời chỉ log, chưa reply
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(200).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});