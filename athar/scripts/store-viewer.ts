// Stores the standalone viewer permanently (Arweave, free tier). The id depends only on the file's bytes, so anyone gets the same one.
import fs from "fs";
import { buildItem, uploadItem, isReadable } from "../web/lib/storage";
(async () => {
  const html = fs.readFileSync(__dirname + "/../viewer/viewer.html");
  const item = await buildItem(html, "text/html");
  const up = await uploadItem(item);
  console.log("id:", item.id, "bytes:", item.bytes, "upload:", up);
  for (let i = 0; i < 6; i++) { if (await isReadable(item.id)) { console.log("readable via a gateway"); break; } await new Promise((r) => setTimeout(r, 5000)); }
  fs.writeFileSync(__dirname + "/../viewer/PERMANENT_ID.txt", item.id + "\n");
})();
