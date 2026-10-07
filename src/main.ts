import { App, ItemView, MarkdownRenderer, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, normalizePath, requestUrl } from "obsidian";
import { AIResult, AnalysisRecord, NoteInput, PRESETS, Poster, buildLatest, buildPrompt, chat, countWords, dateFromName, isDue, nextDue, normalize, parseJSON, parseTime, renderReport, renderTrends } from "./core";

interface Settings { preset: string; baseUrl: string; apiKey: string; model: string; scope: "all" | "folder" | "tag"; scopeValue: string; windowDays: number; reportFolder: string;
  autoAnalyze: boolean; autoIntervalDays: number; autoTime: string; }
const DEFAULTS: Settings = { preset: "openai", ...PRESETS.openai, apiKey: "", scope: "all", scopeValue: "", windowDays: 3, reportFolder: "Idea Pulse",
  autoAnalyze: true, autoIntervalDays: 3, autoTime: "09:00" };
const CHECK_EVERY_MS = 30 * 60 * 1000;      // auto-analyze check interval
const RETRY_AFTER_FAIL_MS = 3 * 3600 * 1000; // don't hammer the AI if an auto run failed
type Trigger = "manual" | "auto" | "uri";
const VIEW = "idea-pulse-chat";

const post: Poster = async (url, headers, body) => {
  const r = await requestUrl({ url, method: "POST", headers, body, throw: false });
  if (r.status >= 400) throw new Error(`AI HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
};

export default class IdeaPulse extends Plugin {
  settings!: Settings; history: AnalysisRecord[] = [];
  lastRunAt: number | null = null; lastAutoFailAt: number | null = null; running = false;

  async onload() {
    const d = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULTS, d.settings); this.history = d.history || [];
    this.lastRunAt = d.lastRunAt ?? (this.history.length ? Date.parse(this.history[this.history.length - 1].date) : null);
    this.lastAutoFailAt = d.lastAutoFailAt ?? null;
    this.addRibbonIcon("activity", "Idea Pulse: analyze last N days", () => this.analyze());
    // External trigger (e.g. a scheduler): obsidian://idea-pulse?action=analyze[&vault=Name]
    // Only asks Obsidian to run the analysis; notes are read and analyzed inside Obsidian by this plugin.
    this.registerObsidianProtocolHandler("idea-pulse", async params => {
      const action = (params.action || "analyze").toLowerCase();
      if (action === "analyze") await this.analyze("uri");
      else if (action === "trends") await this.writeTrends(true);
      else new Notice(`Idea Pulse: unknown action "${action}" (use action=analyze)`);
    });
    // Auto-analyze: check once the vault is indexed, then every 30 minutes.
    this.app.workspace.onLayoutReady(() => { void this.autoCheck(); });
    this.registerInterval(window.setInterval(() => { void this.autoCheck(); }, CHECK_EVERY_MS));
    this.addRibbonIcon("message-circle", "Idea Pulse: chat", () => this.openChat());
    this.addCommand({ id: "analyze", name: "Analyze last N days", callback: () => this.analyze() });
    this.addCommand({ id: "chat", name: "Open chat about recent notes", callback: () => this.openChat() });
    this.addCommand({ id: "trends", name: "Update trends note", callback: () => this.writeTrends(true) });
    this.registerView(VIEW, l => new ChatView(l, this));
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async save() { await this.saveData({ settings: this.settings, history: this.history, lastRunAt: this.lastRunAt, lastAutoFailAt: this.lastAutoFailAt }); }

  nextAutoRun(): number | null {
    const s = this.settings; return s.autoAnalyze ? nextDue(this.lastRunAt, s.autoIntervalDays, s.autoTime, Date.now()) : null;
  }
  /** Runs the analysis once if the schedule says it's due (or overdue, e.g. Obsidian was closed). */
  async autoCheck(now = Date.now()): Promise<boolean> {
    const s = this.settings;
    if (!s.autoAnalyze || this.running) return false;
    if (!s.apiKey && s.preset !== "ollama") return false; // not configured yet — stay silent
    if (this.lastAutoFailAt && now - this.lastAutoFailAt < RETRY_AFTER_FAIL_MS) return false;
    if (!isDue(this.lastRunAt, s.autoIntervalDays, s.autoTime, now)) return false;
    await this.analyze("auto"); return true;
  }

  ai(messages: { role: string; content: string }[], json = false) {
    const s = this.settings;
    if (!s.apiKey && s.preset !== "ollama") throw new Error("Set your API key in Settings → Idea Pulse");
    return chat(post, s.baseUrl, s.apiKey, s.model, messages, json);
  }

  inScope(f: TFile): boolean {
    const s = this.settings;
    if (f.path.startsWith(normalizePath(s.reportFolder) + "/")) return false;
    if (s.scope === "folder") return !s.scopeValue || f.path.startsWith(normalizePath(s.scopeValue) + "/");
    if (s.scope === "tag") {
      const want = s.scopeValue.replace(/^#/, "").toLowerCase(); const c = this.app.metadataCache.getFileCache(f);
      const tags = [...(c?.tags || []).map(t => t.tag), ...([] as string[]).concat(c?.frontmatter?.tags || [])].map(t => String(t).replace(/^#/, "").toLowerCase());
      return tags.some(t => t === want || t.startsWith(want + "/"));
    }
    return true;
  }

  async collect(): Promise<NoteInput[]> {
    const since = Date.now() - this.settings.windowDays * 86400000; const out: NoteInput[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.inScope(f)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      const fmDate = fm?.date || fm?.created ? new Date(fm.date || fm.created).getTime() : NaN;
      const nameDate = dateFromName(f.basename);
      const t = Math.max(f.stat.mtime, f.stat.ctime, isNaN(fmDate) ? 0 : fmDate, nameDate ?? 0);
      if (t < since) continue;
      const text = await this.app.vault.cachedRead(f);
      out.push({ path: f.path, name: f.basename, text, words: countWords(text) });
    }
    return out;
  }

  async analyze(trigger: Trigger = "manual") {
    if (this.running) { new Notice("Idea Pulse: analysis already running"); return; }
    this.running = true;
    const n = new Notice(trigger === "manual" ? "Idea Pulse: analyzing…" : `Idea Pulse: ${trigger === "auto" ? "scheduled" : "external"} analysis…`, 0);
    try {
      const notes = await this.collect();
      if (!notes.length) {
        new Notice(`Idea Pulse: no notes in the last ${this.settings.windowDays} days (check scope in settings).`);
        this.lastRunAt = Date.now(); this.lastAutoFailAt = null; await this.save();
        await this.writeLatest(null, null, [], trigger, new Date().toISOString());
        return;
      }
      const raw = await this.ai([{ role: "user", content: buildPrompt(notes, this.history) }], true);
      const r = normalize(parseJSON<AIResult>(raw));
      const now = new Date(); const date = now.toISOString();
      const folder = normalizePath(this.settings.reportFolder); await this.ensureFolder(folder);
      const stem = `${folder}/Idea Pulse ${date.slice(0, 16).replace("T", " ").replace(":", "-")}`;
      let reportPath = normalizePath(`${stem}.md`);
      for (let i = 2; this.app.vault.getAbstractFileByPath(reportPath); i++) reportPath = normalizePath(`${stem} (${i}).md`);
      const rec: AnalysisRecord = { id: date, date, windowDays: this.settings.windowDays, notes: notes.length,
        words: notes.reduce((s, x) => s + x.words, 0), scores: { novelty: r.overall.novelty, strength: r.overall.strength, anxiety: r.overall.anxiety },
        baseline: this.history.length === 0, reportPath };
      const prev = this.history.slice(); // snapshot; empty => this report is the baseline
      const md = renderReport(r, rec, prev, new Map(notes.map(x => [x.path, x.name])));
      const file = await this.app.vault.create(reportPath, md);
      this.history.push(rec); this.lastRunAt = now.getTime(); this.lastAutoFailAt = null; await this.save(); await this.writeTrends(false);
      await this.writeLatest(r, rec, prev, trigger, date);
      if (trigger === "manual") await this.app.workspace.getLeaf(true).openFile(file);
      new Notice(trigger === "manual" ? "Idea Pulse: report ready" : `Idea Pulse: new report — ${file.basename}`);
    } catch (e: any) {
      if (trigger !== "manual") { this.lastAutoFailAt = Date.now(); await this.save(); }
      new Notice("Idea Pulse error: " + e.message, 8000); console.error(e);
    } finally { n.hide(); this.running = false; }
  }

  /** Small machine-readable summary for other tools: scores, deltas, top insights. Never contains note text. */
  async writeLatest(r: AIResult | null, rec: AnalysisRecord | null, prev: AnalysisRecord[], trigger: Trigger, date: string) {
    const folder = normalizePath(this.settings.reportFolder); await this.ensureFolder(folder);
    const latest = buildLatest({ r, rec, prev, trigger, date, windowDays: this.settings.windowDays,
      trendsPath: normalizePath(`${folder}/Trends.md`), analysesTotal: this.history.length, nextAutoRun: this.nextAutoRun() });
    await this.app.vault.adapter.write(normalizePath(`${folder}/latest.json`), JSON.stringify(latest, null, 2));
  }

  async writeTrends(open: boolean) {
    const folder = normalizePath(this.settings.reportFolder); await this.ensureFolder(folder);
    const p = normalizePath(`${folder}/Trends.md`); const md = renderTrends(this.history);
    const f = this.app.vault.getAbstractFileByPath(p);
    const file = f instanceof TFile ? (await this.app.vault.modify(f, md), f) : await this.app.vault.create(p, md);
    if (open) await this.app.workspace.getLeaf(true).openFile(file);
  }
  async ensureFolder(p: string) { if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p); }

  async openChat() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false)!; await leaf.setViewState({ type: VIEW, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
}

class ChatView extends ItemView {
  msgs: { role: string; content: string }[] = []; log!: HTMLElement;
  constructor(leaf: WorkspaceLeaf, private plugin: IdeaPulse) { super(leaf); }
  getViewType() { return VIEW; } getDisplayText() { return "Idea Pulse chat"; } getIcon() { return "message-circle"; }
  async onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("idea-pulse-chat");
    c.createEl("div", { cls: "ip-hint", text: `Ask about notes from the last ${this.plugin.settings.windowDays} days, e.g. "Is there a connection between X and Y?"` });
    this.log = c.createDiv("ip-log");
    const form = c.createEl("form", { cls: "ip-form" }); const ta = form.createEl("textarea", { attr: { placeholder: "Ask…", rows: "3" } });
    form.createEl("button", { text: "Send", attr: { type: "submit" } });
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async e => { e.preventDefault(); const q = ta.value.trim(); if (q) { ta.value = ""; await this.ask(q); } };
  }
  async add(role: string, text: string) {
    const el = this.log.createDiv(`ip-msg ip-${role}`);
    await MarkdownRenderer.render(this.app, text, el, "", this); this.log.scrollTop = this.log.scrollHeight; return el;
  }
  async ask(q: string) {
    await this.add("user", q); const wait = this.log.createDiv({ cls: "ip-msg ip-wait", text: "…" });
    try {
      if (!this.msgs.length) {
        const notes = await this.plugin.collect();
        const ctx = notes.map(n => `### [[${n.name}]]\n${n.text.slice(0, Math.floor(60000 / Math.max(1, notes.length)))}`).join("\n\n");
        this.msgs.push({ role: "system", content: `You help the user think about their recent notes. Answer in the user's language, concisely, citing notes as [[Note name]] wikilinks. Notes from the last ${this.plugin.settings.windowDays} days:\n\n${ctx || "(no notes)"}` });
      }
      this.msgs.push({ role: "user", content: q });
      const a = await this.plugin.ai(this.msgs); this.msgs.push({ role: "assistant", content: a });
      wait.remove(); await this.add("assistant", a);
    } catch (e: any) { wait.setText("Error: " + e.message); this.msgs.pop(); }
  }
}

class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: IdeaPulse) { super(app, plugin); }
  display() {
    const { containerEl: c } = this; c.empty(); const s = this.plugin.settings; const save = () => this.plugin.save();
    new Setting(c).setName("AI provider").setDesc("Any OpenAI-compatible endpoint. Choosing a preset fills URL and model.")
      .addDropdown(d => d.addOptions({ openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", ollama: "Ollama (local)", custom: "Custom" })
        .setValue(s.preset).onChange(async v => { s.preset = v; if (PRESETS[v]) Object.assign(s, PRESETS[v]); await save(); this.display(); }));
    new Setting(c).setName("Base URL").addText(t => t.setValue(s.baseUrl).onChange(async v => { s.baseUrl = v.trim(); await save(); }));
    new Setting(c).setName("API key").setDesc("Stored in this vault's plugin data. Not needed for Ollama.")
      .addText(t => { t.inputEl.type = "password"; t.setValue(s.apiKey).onChange(async v => { s.apiKey = v.trim(); await save(); }); });
    new Setting(c).setName("Model").addText(t => t.setValue(s.model).onChange(async v => { s.model = v.trim(); await save(); }));
    new Setting(c).setName("Source scope").setDesc("Which notes to analyze: all, one folder (e.g. Home), or a tag.")
      .addDropdown(d => d.addOptions({ all: "All notes", folder: "Folder", tag: "Tag" }).setValue(s.scope).onChange(async v => { s.scope = v as any; await save(); this.display(); }));
    if (s.scope !== "all") new Setting(c).setName(s.scope === "folder" ? "Folder path" : "Tag").addText(t => t.setPlaceholder(s.scope === "folder" ? "Home" : "#idea").setValue(s.scopeValue).onChange(async v => { s.scopeValue = v.trim(); await save(); }));
    new Setting(c).setName("Window (days)").addText(t => t.setValue(String(s.windowDays)).onChange(async v => { const n = parseInt(v); if (n > 0) { s.windowDays = n; await save(); } }));
    c.createEl("h3", { text: "Auto-analyze" });
    const next = this.plugin.nextAutoRun();
    new Setting(c).setName("Auto-analyze").setDesc(`Runs the analysis inside Obsidian on a schedule. Checked on startup and every 30 min; a missed run (Obsidian was closed) runs once on next start.${next ? " Next: " + new Date(next).toLocaleString() : ""}`)
      .addToggle(t => t.setValue(s.autoAnalyze).onChange(async v => { s.autoAnalyze = v; await save(); this.display(); }));
    if (s.autoAnalyze) {
      new Setting(c).setName("Every N days").addText(t => t.setValue(String(s.autoIntervalDays)).onChange(async v => { const n = parseInt(v); if (n > 0) { s.autoIntervalDays = n; await save(); } }));
      new Setting(c).setName("Time of day").setDesc("24h, HH:MM").addText(t => { t.inputEl.type = "time"; t.setValue(s.autoTime).onChange(async v => { if (parseTime(v)) { s.autoTime = v; await save(); } }); });
    }
    new Setting(c).setName("External trigger").setDesc("obsidian://idea-pulse?action=analyze — lets a scheduler start the analysis in Obsidian. Results: <report folder>/latest.json");
    new Setting(c).setName("Report folder").addText(t => t.setValue(s.reportFolder).onChange(async v => { s.reportFolder = v.trim() || "Idea Pulse"; await save(); }));
    new Setting(c).setName("Analyses stored").setDesc(`${this.plugin.history.length} in history`).addButton(b => b.setButtonText("Test connection").onClick(async () => {
      try { await this.plugin.ai([{ role: "user", content: "Reply with OK" }]); new Notice("Idea Pulse: connection OK"); } catch (e: any) { new Notice("Failed: " + e.message, 8000); }
    }));
  }
}
