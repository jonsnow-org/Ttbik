// Local Telegram Bot API stub for QA. Records every call; GET /__calls, POST /__reset.
const http = require("http");
const PORT = Number(process.env.TG_MOCK_PORT || 54400);
let calls = [];
let mid = 1000;
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA==", "base64");
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__calls") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(calls)); }
    if (req.url === "/__reset") { calls = []; return res.end("{}"); }
    if (req.url.startsWith("/file/")) { res.setHeader("content-type", "image/jpeg"); return res.end(JPEG); }
    const m = req.url.match(/^\/bot[^/]+\/(\w+)/);
    const method = m ? m[1] : req.url;
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { payload = { raw: body.slice(0, 500) }; }
    calls.push({ at: Date.now(), method, payload });
    let result = true;
    if (method === "getMe") result = { id: 777000, is_bot: true, first_name: "QA Match", username: "qa_match_bot" };
    else if (/^send|^edit|^copy|^forward/.test(method)) result = { message_id: ++mid, date: Math.floor(Date.now() / 1000), chat: { id: Number(payload.chat_id) || 0, type: "private" }, text: payload.text };
    else if (method === "createInvoiceLink") result = "https://t.me/$qa_invoice_" + mid++;
    else if (method === "getFile") result = { file_id: payload.file_id, file_unique_id: "u", file_size: JPEG.length, file_path: "photos/qa.jpg" };
    else if (method === "getChatMember") result = { status: "member", user: { id: 1 } };
    else if (method === "getWebhookInfo") result = { url: "", pending_update_count: 0 };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result }));
  });
}).listen(PORT, () => console.log("tg-mock on", PORT));
