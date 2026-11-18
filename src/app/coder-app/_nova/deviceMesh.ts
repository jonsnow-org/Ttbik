"use client";
// The user's own device as a node of the selected model's mesh (src/lib/meshNode.ts). Opt-in per user on this device (Settings switch, off by
// default); one mesh and one key per model, so switching the model leaves the old mesh (no cross-model routing). Local-first: the key, the
// kept lessons and the switch live in this device's storage only. It runs only while the Mini App is open; idle compute is served only while
// the app is visible. The owner deny list is checked server-side (op mesh_vet) without revealing it to the device.
import { useEffect, useState } from "react";
import { DeviceNode, MeshIdentity, ed25519Supported, meshForModel, type Lesson, type MeshStats, type SavedKey } from "@/lib/meshNode";
import { api } from "./parts";

const ON = (mesh: string) => `mesh_on:${mesh}`;
const KEY = (mesh: string) => `mesh_key:${mesh}`;
const LESSONS = (mesh: string) => `mesh_lessons:${mesh}`;
const MAX_KEPT = 500;

type State = { mesh: string | null; supported: boolean | null; on: boolean; stats: MeshStats | null; error: string };
let node: DeviceNode | null = null;
let current: string | null = null;
let state: State = { mesh: null, supported: null, on: false, stats: null, error: "" };
const subs = new Set<(s: State) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function emit(p: Partial<State>) {
  state = { ...state, ...p };
  for (const f of subs) f(state);
}
function read(k: string): string {
  try { return localStorage.getItem(k) || ""; } catch { return ""; }
}
function write(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* storage full or blocked: the node still runs for this session */ }
}

async function identity(mesh: string): Promise<MeshIdentity> {
  const saved = read(KEY(mesh));
  if (saved) {
    try { return await MeshIdentity.load(JSON.parse(saved) as SavedKey); } catch { /* corrupt: make a new one */ }
  }
  const id = await MeshIdentity.generate();
  write(KEY(mesh), JSON.stringify(await id.save()));
  return id;
}

async function stop() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  const n = node;
  node = null;
  if (n) await n.stop().catch(() => null);
  emit({ stats: null });
}

/** Start / stop this device's node for `model` according to the user's switch. Safe to call on every render. */
export async function syncDeviceMesh(model: string): Promise<void> {
  const mesh = meshForModel(model);
  if (mesh !== current) {
    await stop();
    current = mesh;
  }
  if (state.supported === null) emit({ supported: await ed25519Supported() });
  const on = !!mesh && read(ON(mesh)) === "1";
  emit({ mesh, on });
  if (!mesh || !on || !state.supported || node) return;
  try {
    const ident = await identity(mesh);
    let restore: Lesson[] = [];
    try { restore = JSON.parse(read(LESSONS(mesh)) || "[]") as Lesson[]; } catch { restore = []; }
    const n = new DeviceNode({
      mesh, ident, restore,
      ownerCheck: async (commands) => (await api<{ reasons: string[] }>("mesh_vet", { commands }, 20000)).reasons,
      idle: () => typeof document === "undefined" || document.visibilityState === "visible",
      persist: (ls) => write(LESSONS(mesh), JSON.stringify(ls.slice(-MAX_KEPT))),
    });
    node = n;
    await n.start();
    if (node !== n) { await n.stop(); return; }
    emit({ stats: n.status(), error: "" });
    ticker = setInterval(() => { if (node) emit({ stats: node.status() }); }, 4000);
  } catch (e) {
    node = null;
    emit({ error: String((e as Error)?.message || e).slice(0, 160) });
  }
}

export async function setDeviceMesh(model: string, on: boolean): Promise<void> {
  const mesh = meshForModel(model);
  if (!mesh) return;
  write(ON(mesh), on ? "1" : "0");
  if (!on) await stop();
  await syncDeviceMesh(model);
}

export function useDeviceMesh(model: string): State {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    subs.add(setS);
    void syncDeviceMesh(model);
    return () => { subs.delete(setS); };
  }, [model]);
  return s;
}
