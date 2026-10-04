// A tiny in-memory stand-in for the parts of supabase-js the media layer uses, so the rules can be tested without a database.
type Row = Record<string, any>;
export class FakeDb {
  tables: Record<string, Row[]> = {};
  failTables = new Set<string>();
  seq = 1;
  from(name: string) { return new Query(this, name); }
}
class Query implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: any; private conflict = "";
  private lim = Infinity; private ord: { col: string; asc: boolean } | null = null;
  private single = false; private head = false; private wantCount = false; private returning = false;
  constructor(private db: FakeDb, private t: string) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op === "select") { /* read */ } else this.returning = true; if (opts?.count) this.wantCount = true; if (opts?.head) this.head = true; return this; }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  upsert(p: any, o?: { onConflict?: string }) { this.op = "upsert"; this.payload = p; this.conflict = o?.onConflict || "id"; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: any) { this.filters.push((r) => new Date(r[c]).getTime() >= new Date(v).getTime()); return this; }
  or() { return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ord = { col: c, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then<R1 = any, R2 = never>(res?: any, rej?: any): Promise<R1 | R2> { return Promise.resolve(this.run()).then(res, rej); }
  private run() {
    if (this.db.failTables.has(this.t)) return { data: null, error: { message: `relation "${this.t}" does not exist`, code: "42P01" } };
    const rows = (this.db.tables[this.t] ||= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const p of list) { const row = { id: p.id ?? this.db.seq++, created_at: new Date().toISOString(), ...p }; const pk = this.t === "media_views" ? ["post_id", "viewer_id"] : this.t === "media_likes" ? ["post_id", "user_id"] : null;
        if (pk && rows.some((r) => pk.every((k) => r[k] === row[k]))) return { data: null, error: { message: "duplicate key", code: "23505" } }; rows.push(row); }
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const key = this.conflict.split(",");
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      for (const p of list) { const i = rows.findIndex((r) => key.every((k) => r[k] === p[k])); if (i >= 0) rows[i] = { ...rows[i], ...p }; else rows.push({ created_at: new Date().toISOString(), ...p }); }
      return { data: null, error: null };
    }
    if (this.op === "update") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, this.payload)); return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null }; }
    if (this.op === "delete") { const hit = rows.filter(match); this.db.tables[this.t] = rows.filter((r) => !match(r)); return { data: this.returning ? hit : null, error: null }; }
    let out = rows.filter(match).map((r) => ({ ...r }));
    if (this.ord) { const { col, asc } = this.ord; out.sort((a, b) => (new Date(a[col]).getTime() - new Date(b[col]).getTime() || (a[col] > b[col] ? 1 : -1)) * (asc ? 1 : -1)); }
    const count = out.length;
    out = out.slice(0, this.lim);
    if (this.head) return { data: null, error: null, count };
    if (this.single) return { data: out[0] ?? null, error: null };
    return { data: out, error: null, count };
  }
}
