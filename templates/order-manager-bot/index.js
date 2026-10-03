// Minimal, free, self-contained order intake + Telegram approval bot.
// - No database: orders are kept in orders.json (fine for a small business).
// - No webhook/public URL required: uses Telegram long-polling for buttons.
// - No dependencies: uses Node's built-in http server + global fetch.
//
// This is a trimmed-down, standalone version of the same
// request -> Telegram alert -> [approve/reject] -> auto-delivery pattern
// used by the main Sham AI platform, for anyone who wants it as its own
// small service without the full Next.js/Supabase stack.

const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "orders.json");

if (!TOKEN || !ADMIN_CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID environment variables.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

function readOrders() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function notifyAdmin(order) {
  const text = [
    `🛒 طلب جديد #${order.id}`,
    `الاسم: ${order.name}`,
    `التواصل: ${order.contact}`,
    `تفاصيل: ${order.note || "-"}`,
  ].join("\n");

  const result = await tg("sendMessage", {
    chat_id: ADMIN_CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "موافقة ✅", callback_data: `approve:${order.id}` },
          { text: "رفض ❌", callback_data: `reject:${order.id}` },
        ],
      ],
    },
  });
  return result?.result?.message_id;
}

// ---- HTTP server: receives new orders from any simple web form ----
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
  }

  if (req.method === "POST" && req.url === "/orders") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { name, contact, note } = JSON.parse(body);
        if (!name || !contact) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "name and contact are required" }));
        }
        const orders = readOrders();
        const order = { id: Date.now(), name, contact, note, status: "pending" };
        orders.push(order);
        writeOrders(orders);
        await notifyAdmin(order);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: order.id }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid request" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/orders/")) {
    const id = Number(req.url.split("/").pop());
    const order = readOrders().find((o) => o.id === id);
    res.writeHead(order ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(order || { error: "not found" }));
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`Order intake server listening on :${PORT}`));

// ---- Telegram long-polling: handles the Approve/Reject button taps ----
async function pollTelegram(offset) {
  const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
  const data = await res.json();
  let nextOffset = offset;

  for (const update of data.result || []) {
    nextOffset = update.update_id + 1;
    const cb = update.callback_query;
    if (!cb) continue;

    const [action, idStr] = String(cb.data || "").split(":");
    const id = Number(idStr);
    const orders = readOrders();
    const order = orders.find((o) => o.id === id);

    if (order && order.status === "pending" && (action === "approve" || action === "reject")) {
      order.status = action === "approve" ? "approved" : "rejected";
      writeOrders(orders);
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "تم التحديث" });
      await tg("sendMessage", {
        chat_id: cb.message.chat.id,
        text: `تم تحديث الطلب #${id} إلى: ${order.status === "approved" ? "✅ موافقة" : "❌ رفض"}`,
      });
    }
  }
  return nextOffset;
}

async function main() {
  console.log("Order-manager bot polling for approvals...");
  let offset = 0;
  for (;;) {
    try {
      offset = await pollTelegram(offset);
    } catch (err) {
      console.error("Poll error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
