// node --experimental-strip-types scripts/mesh/device_node.mts --url <relay> --mesh <name> [--hold 120] [--publish "task=>command"]
// Runs the Mini App's own mesh code (src/lib/meshNode.ts) as one device node: joins, optionally publishes one lesson from "its own work",
// serves idle jobs and proposals from its vetted lessons, prints `RESULT {...}` lines (mesh_net_e2e.py reads them).
import { MeshIdentity, DeviceNode } from "../../src/lib/meshNode.ts";

const arg = (k: string, d = ""): string => {
  const i = process.argv.indexOf("--" + k);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const emit = (o: unknown) => console.log("RESULT " + JSON.stringify(o));
const ident = await MeshIdentity.generate();
const node = new DeviceNode({ url: arg("url"), mesh: arg("mesh"), ident, denyList: () => (arg("deny") ? arg("deny").split(",") : []), heartbeatMs: 10000, pollWait: 10 });
await node.start();
let published: unknown = null;
const pub = arg("publish");
if (pub.includes("=>")) {
  const [task, command] = pub.split("=>");
  published = await node.publish(task, command);
}
emit({ role: "device", id: ident.id, online: node.online, lessons_received: node.pool.size, published });
const hold = Number(arg("hold", "120")) * 1000;
const t0 = Date.now();
while (Date.now() - t0 < hold) {
  await new Promise((r) => setTimeout(r, 2000));
  if (process.stdin.readableEnded) break;
}
emit({ role: "device", id: ident.id, stats: node.status(), rejected: Object.fromEntries(node.rejected) });
await node.stop();
process.exit(0);
