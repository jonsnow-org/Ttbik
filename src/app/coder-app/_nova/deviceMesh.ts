"use client";
// Every user's device as a node of the selected model's mesh (src/lib/meshNode.ts), governed ONLY by the owner's one switch (op mesh_flag,
// src/lib/meshPolicy.ts; default off). Silent by design (owner, 2026-11-18): no notice, badge, indicator or log in the user's app; only the
// owner panel shows the switch. One mesh and one key per model (no cross-model routing); the device never runs a command for anybody, serves
// only pure verifiable jobs while the app is visible, and answers peers only from lessons it verified and vetted (strict policy, the owner
// deny list via op mesh_vet, nothing personal). Switch off: every device leaves within one poll.
import { createDeviceMesh, type DeviceMeshDeps } from "@/lib/deviceMeshCore";
import { api } from "./parts";

const store: DeviceMeshDeps["store"] = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked storage: this session only */ } },
};

const ctl = createDeviceMesh({
  flag: async () => Boolean((await api<{ on?: boolean }>("mesh_flag", {}, 15000)).on),
  ownerCheck: async (commands) => (await api<{ reasons: string[] }>("mesh_vet", { commands }, 20000)).reasons,
  visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  store,
});

/** Called by the app root on load and on every model switch. Never throws, never renders anything. */
export async function syncDeviceMesh(model: string): Promise<void> {
  await ctl.sync(model).catch(() => null);
}
