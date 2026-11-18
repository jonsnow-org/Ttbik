// Prints the exact texts Nova sends (the full START: system text + tool list, and the short "lite" system text used for greetings), as JSON,
// so the speed probe (nova-speed.yml) reads what the bot really sends. Nothing secret; no network.
import { coderSystemPrompt, coderToolsFor } from "@/lib/coderAgent";
import { withModelIdentity } from "@/lib/coderSections";
import { NOVA_LITE_SYSTEM } from "@/lib/modes";
const github = process.argv.includes("--github");
const model = process.argv.find((a) => a.startsWith("--model="))?.slice(8) || "coder";
const sys = withModelIdentity(coderSystemPrompt({ github, owner: true, connectors: [], notes: "", date: false }), model);
const msgs = [{ role: "system" as const, content: sys }, { role: "user" as const, content: "hello" }];
const tools = coderToolsFor(github, false, msgs as never, []);
process.stdout.write(JSON.stringify({ system: sys, tools, lite: withModelIdentity(NOVA_LITE_SYSTEM, model) }));
