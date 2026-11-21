/**
 * The controller behind src/app/coder-app/_nova/deviceMesh.ts, free of React and of the Mini App's API so it can be checked in a plain
 * browser or Node (scripts/mesh/). It follows the owner's switch: polls `flag()`; on -> joins the selected model's mesh with this device's
 * key for that model; off -> says bye and stops. Silent: it never logs or surfaces anything.
 */
import { DeviceNode, MeshIdentity, ed25519Supported, meshForModel, type Lesson, type SavedKey } from "./meshNode";

export type DeviceMeshDeps = {
  flag: () => Promise<boolean>;
  ownerCheck: (commands: string[]) => Promise<string[]>;
  visible: () => boolean;
  store: { get: (k: string) => string; set: (k: string, v: string) => void };
  url?: string;
  pollMs?: number;
  heartbeatMs?: number;
};

const KEY = (mesh: string) => `nv_mk:${mesh}`;
const LESSONS = (mesh: string) => `nv_ml:${mesh}`;
const MAX_KEPT = 500;

export function createDeviceMesh(deps: DeviceMeshDeps) {
  let node: DeviceNode | null = null;
  let mesh: string | null = null;
  let model = "";
  let supported: boolean | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function identity(m: string): Promise<MeshIdentity> {
    const saved = deps.store.get(KEY(m));
    if (saved) {
      try { return await MeshIdentity.load(JSON.parse(saved) as SavedKey); } catch { /* corrupt: make a new one */ }
    }
    const id = await MeshIdentity.generate();
    deps.store.set(KEY(m), JSON.stringify(await id.save()));
    return id;
  }

  async function stop(): Promise<void> {
    const n = node;
    node = null;
    if (n) await n.stop().catch(() => null);
  }

  async function start(m: string): Promise<void> {
    const ident = await identity(m);
    let restore: Lesson[] = [];
    try { restore = JSON.parse(deps.store.get(LESSONS(m)) || "[]") as Lesson[]; } catch { restore = []; }
    const n = new DeviceNode({
      url: deps.url, mesh: m, ident, restore,
      ownerCheck: deps.ownerCheck,
      idle: deps.visible,
      persist: (ls) => deps.store.set(LESSONS(m), JSON.stringify(ls.slice(-MAX_KEPT))),
      heartbeatMs: deps.heartbeatMs ?? 55000,          // the relay keeps a node online 75 s; fewer calls keep many devices inside the free plan
      pollWait: 25,
    });
    node = n;
    await n.start();
  }

  /** One reconciliation: wanted = owner switch on AND the model has a mesh AND this device can sign. */
  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      let on = false;
      try { on = await deps.flag(); } catch { on = Boolean(node); }      // a failed poll keeps the current state
      const want = on && !!mesh && supported === true;
      if (!want && node) await stop();
      else if (want && node && node.mesh !== mesh) { await stop(); await start(mesh as string); }
      else if (want && !node) await start(mesh as string);
    } catch {
      node = null;
    } finally {
      busy = false;
    }
  }

  return {
    async sync(m: string): Promise<void> {
      model = m;
      mesh = meshForModel(model);
      if (supported === null) supported = await ed25519Supported();
      await tick();
      if (!timer) timer = setInterval(() => void tick(), deps.pollMs ?? 30000);
    },
    async shutdown(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = null;
      await stop();
    },
    /** For checks only (scripts/mesh): never shown in the app. */
    state: () => ({ running: Boolean(node), online: Boolean(node?.online), mesh, id: node?.ident.id || "" }),
  };
}
