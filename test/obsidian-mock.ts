// Minimal fake of the Obsidian API for node tests.
export const calls: any = { notices: [] as string[], uri: {} as Record<string, Function>, intervals: [] as number[], layoutReady: [] as Function[], opened: [] as string[], posts: [] as any[] };
export let aiReply: (body: any) => any = () => { throw new Error("no ai"); };
export function setAI(f: (body: any) => any) { aiReply = f; }
export class TFile { path: string; basename: string; stat: any; extension = "md"; constructor(p: string, t: number) { this.path = p; this.basename = p.split("/").pop()!.replace(/\.md$/, ""); this.stat = { mtime: t, ctime: t }; } }
export class Notice { constructor(m: string) { calls.notices.push(m); } hide() {} setMessage() {} }
export const normalizePath = (p: string) => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
export async function requestUrl(o: any) { calls.posts.push(o); const j = aiReply(JSON.parse(o.body)); return { status: 200, json: j, text: JSON.stringify(j) }; }
export class Plugin {
  app: any; data: any = null; constructor(app: any) { this.app = app; }
  async loadData() { return this.data; } async saveData(d: any) { this.data = JSON.parse(JSON.stringify(d)); }
  addRibbonIcon() {} addCommand() {} registerView() {} addSettingTab() {}
  registerObsidianProtocolHandler(a: string, f: Function) { calls.uri[a] = f; }
  registerInterval(id: number) { calls.intervals.push(id); return id; }
}
export class PluginSettingTab { constructor(..._a: any[]) {} }
export class ItemView { constructor(..._a: any[]) {} }
export class Setting { constructor(..._a: any[]) {} }
export const MarkdownRenderer = { render: async () => {} };
export type App = any; export type WorkspaceLeaf = any;
export function makeApp(notes: Record<string, { text: string; t: number }>) {
  const files = new Map<string, any>(); const raw = new Map<string, string>();
  for (const [p, n] of Object.entries(notes)) { files.set(p, new TFile(p, n.t)); raw.set(p, n.text); }
  const folders = new Set<string>();
  return {
    raw, files,
    vault: {
      getMarkdownFiles: () => [...files.values()].filter(f => f.path.endsWith(".md")),
      cachedRead: async (f: any) => raw.get(f.path)!,
      getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? { folder: true } : null),
      createFolder: async (p: string) => { folders.add(p); },
      create: async (p: string, d: string) => { if (files.has(p)) throw new Error("exists " + p); const f = new TFile(p, Date.now()); files.set(p, f); raw.set(p, d); return f; },
      modify: async (f: any, d: string) => { raw.set(f.path, d); },
      adapter: { write: async (p: string, d: string) => { raw.set(p, d); } },
    },
    metadataCache: { getFileCache: () => ({}) },
    workspace: { onLayoutReady: (f: Function) => calls.layoutReady.push(f), getLeaf: () => ({ openFile: async (f: any) => calls.opened.push(f.path) }), getLeavesOfType: () => [] },
  };
}
