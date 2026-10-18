// Fails (exit 1) when something that must stay fixed after ZNBt's launch has drifted. No dependencies: runs in CI and locally.
//   node scripts/znbt-frozen-check.mjs           file-level checks (always)
//   node scripts/znbt-frozen-check.mjs --chain   also recomputes the master address from the contract SDK (needs contracts/zenobia-curve/sdk deps)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
const F = JSON.parse(read("deploy/hosting/znbt-frozen.json"));
const bad = [];
const must = (ok, msg) => { if (!ok) bad.push(msg); };

const base = JSON.parse(read("src/lib/znbtBase.json"));
must(base.master === F.master, `src/lib/znbtBase.json master is ${base.master}, must be ${F.master}`);
const cfgTs = read("src/lib/znbtConfig.ts");
must(cfgTs.includes(`OWNER_WALLET = "${F.owner}"`), "src/lib/znbtConfig.ts: OWNER_WALLET changed");
must(cfgTs.includes(`ZNBT_SALT = "${F.salt}"`), "src/lib/znbtConfig.ts: ZNBT_SALT changed");
must(/SALT = 1_?000_?001n/.test(read("contracts/zenobia-curve/web/src/launch.ts")), "launch.ts: SALT is not 1_000_001n");
must(read("contracts/zenobia-curve/web/src/common.ts").includes(F.owner), "web/src/common.ts: OWNER changed");
must(read("src/lib/znbtHide.ts").includes(F.owner), "src/lib/znbtHide.ts: owner wallet changed");
must(read("contracts/zenobia-curve/web/src/metadata.ts").includes(`image: '${F.imageUrl}'`), "metadata.ts: the on-chain image address changed");
must(read("contracts/zenobia-curve/web/src/verify.ts").includes(F.imageUrl), "verify.ts: expects another image address");
for (const p of F.publicPaths) must(existsSync(join(root, p)), `missing: ${p} (links and the on-chain image depend on it)`);
// old links keep working: the trade page still reads ?c= and the list still links to it
must(/get\('c'\)/.test(read("contracts/zenobia-curve/web/src/trade.ts")), "trade.ts no longer reads the ?c= parameter of shared links");
must(read("contracts/zenobia-curve/web/src/coins.ts").includes("/zenobia/trade.html?c="), "coins.ts no longer links to trade.html?c=");
// the gate must keep serving the icon from its own copy when both servers are down
must(read("cloudflare/site-gate/worker.js").includes("/api/zenobia/znbt/icon"), "gate worker lost its icon safety net");

if (process.argv.includes("--chain")) {
  try {
    const { deployMaster } = await import(new URL("../contracts/zenobia-curve/sdk/dist/index.js", import.meta.url));
    const { Address } = await import(new URL("../contracts/zenobia-curve/sdk/node_modules/@ton/core/dist/index.js", import.meta.url));
    const o = Address.parse(F.owner);
    must(deployMaster(o, o).to.toString({ bounceable: true }) === F.master, "the master address computed from the contract code is not the frozen one: the contract code changed");
  } catch (e) { bad.push("--chain: could not run the SDK (" + String(e.message).slice(0, 80) + ")"); }
}

if (bad.length) { console.error("ZNBt frozen rules broken:\n - " + bad.join("\n - ")); process.exit(1); }
console.log("ZNBt frozen rules: all intact" + (process.argv.includes("--chain") ? " (including the master address from the contract code)" : ""));
