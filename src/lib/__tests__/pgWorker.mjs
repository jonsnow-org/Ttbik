// Test helper (see pgDb.ts): a PGlite instance in its own Node process, driven with one JSON message per line on stdin.
import { PGlite } from "@electric-sql/pglite";
import readline from "node:readline";

const pg = new PGlite();
let chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  chain = chain.then(async () => {
    try {
      let out;
      if (msg.params?.length) {
        const r = await pg.query(msg.sql, msg.params);
        out = { rows: r.rows, affected: r.affectedRows ?? 0 };
      } else {
        const r = await pg.query(msg.sql);
        out = { rows: r.rows, affected: r.affectedRows ?? 0 };
      }
      process.stdout.write(JSON.stringify({ id: msg.id, ...out }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: msg.id, error: String(e && e.message || e) }) + "\n");
    }
  });
});
