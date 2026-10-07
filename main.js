"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => IdeaPulse
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core.ts
var PRESETS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" }
};
async function chat(post2, baseUrl, apiKey, model, messages, json = false) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (baseUrl.includes("anthropic.com")) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  const body = { model, messages, temperature: 0.4 };
  if (json && !baseUrl.includes("anthropic.com")) body.response_format = { type: "json_object" };
  const res = await post2(baseUrl.replace(/\/+$/, "") + "/chat/completions", headers, JSON.stringify(body));
  const c = res?.choices?.[0]?.message?.content;
  if (typeof c !== "string") throw new Error("Unexpected AI response: " + JSON.stringify(res).slice(0, 300));
  return c;
}
function countWords(t) {
  return (t.match(/[\p{L}\p{N}]+/gu) || []).length;
}
var DATE_RE = /(\d{4})[-_.](\d{2})[-_.](\d{2})/;
function dateFromName(name) {
  const m = name.match(DATE_RE);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return isNaN(d) ? null : d;
}
function buildPrompt(notes, prev, maxChars = 6e4) {
  const per = Math.max(800, Math.floor(maxChars / Math.max(1, notes.length)));
  const body = notes.map((n) => `### [[${n.name}]] (path: ${n.path})
${n.text.slice(0, per)}`).join("\n\n");
  const hist = prev.slice(-5).map((p) => `${p.date}: novelty ${p.scores.novelty}, strength ${p.scores.strength}, anxiety ${p.scores.anxiety}`).join("\n");
  return `You analyze a person's recent notes and ideas. Answer in the SAME language as the notes.
Return ONLY JSON:
{"language":"ru|en|...","summary":"3-6 sentences","insights":["new insight derived by combining notes", ...],
"connections":[{"a":"note name","b":"note name","why":"one line"}],
"notes":[{"path":"exact path","novelty":0-10,"strength":0-10,"anxiety":0-10,"reason":"one line"}],
"overall":{"novelty":0-10,"strength":0-10,"anxiety":0-10,"reason":"one line"}}
Novelty = how new the ideas are vs typical/earlier thinking. Strength = how strong, actionable and adaptable the ideas are. Anxiety = how anxious/stressed the tone is (0 calm, 10 very anxious).
Previous analyses (for context):
${hist || "none"}

NOTES:
${body}`;
}
function parseJSON(s) {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI did not return JSON");
  return JSON.parse(m[0]);
}
var clamp = (x) => Math.max(0, Math.min(10, Math.round(Number(x) * 10) / 10 || 0));
function normalize(r) {
  r.insights || (r.insights = []);
  r.connections || (r.connections = []);
  r.notes || (r.notes = []);
  r.notes.forEach((n) => {
    n.novelty = clamp(n.novelty);
    n.strength = clamp(n.strength);
    n.anxiety = clamp(n.anxiety);
  });
  r.overall = { novelty: clamp(r.overall?.novelty), strength: clamp(r.overall?.strength), anxiety: clamp(r.overall?.anxiety), reason: r.overall?.reason || "" };
  return r;
}
var fmt = (d) => (d > 0 ? "+" : "") + d.toFixed(1);
var arrow = (d) => d > 0.25 ? "\u2191" : d < -0.25 ? "\u2193" : "\u2192";
function compare(cur, prev) {
  if (!prev.length) return "_Baseline analysis \u2014 not used for comparison; next reports will compare against it._";
  const last = prev[prev.length - 1];
  const avg = (k) => prev.reduce((s, p) => s + p.scores[k], 0) / prev.length;
  const rows = ["novelty", "strength", "anxiety"].map((k) => {
    const d = cur[k] - last.scores[k];
    const da = cur[k] - avg(k);
    return `| ${label(k)} | ${cur[k]} | ${last.scores[k]} | ${fmt(d)} ${arrow(d)} | ${fmt(da)} ${arrow(da)} |`;
  });
  return `| Metric | Now | Previous | \u0394 prev | \u0394 avg (${prev.length}) |
|---|---|---|---|---|
${rows.join("\n")}`;
}
var label = (k) => ({ novelty: "Novelty", strength: "Idea strength", anxiety: "Anxiety" })[k];
function renderReport(r, rec, prev, names) {
  const link = (p) => `[[${names.get(p) ?? p.replace(/\.md$/, "")}]]`;
  const fm = [
    "---",
    `idea_pulse: true`,
    `date: ${rec.date}`,
    `window_days: ${rec.windowDays}`,
    `notes: ${rec.notes}`,
    `words: ${rec.words}`,
    `novelty: ${rec.scores.novelty}`,
    `strength: ${rec.scores.strength}`,
    `anxiety: ${rec.scores.anxiety}`,
    `baseline: ${rec.baseline}`,
    "---"
  ].join("\n");
  return `${fm}
# Idea Pulse \u2014 ${rec.date.slice(0, 10)}

**Window:** last ${rec.windowDays} days \xB7 **Volume of work:** ${rec.notes} notes, ${rec.words} words

## Summary
${r.summary}

## New insights
${r.insights.map((i) => `- ${i}`).join("\n") || "- \u2014"}

## Connections
${r.connections.map((c) => `- [[${c.a}]] \u2194 [[${c.b}]] \u2014 ${c.why}`).join("\n") || "- \u2014"}

## Scores (0\u201310)
| | Novelty | Idea strength | Anxiety |
|---|---|---|---|
| **Overall** | ${r.overall.novelty} | ${r.overall.strength} | ${r.overall.anxiety} |

${r.overall.reason}

### Per note
| Note | Nov | Str | Anx | Why |
|---|---|---|---|---|
${r.notes.map((n) => `| ${link(n.path)} | ${n.novelty} | ${n.strength} | ${n.anxiety} | ${(n.reason || "").replace(/\|/g, "/")} |`).join("\n")}

## Compared to previous analyses
${compare(rec.scores, prev)}
`;
}
function renderTrends(h) {
  const rows = h.map((r) => `| ${r.date.slice(0, 10)} | ${r.windowDays}d | ${r.notes} | ${r.words} | ${r.scores.novelty} | ${r.scores.strength} | ${r.scores.anxiety} | ${r.baseline ? "baseline" : ""} | [[${r.reportPath.replace(/\.md$/, "")}\\|report]] |`);
  const cmp = h.filter((r) => !r.baseline);
  const avg = (k) => cmp.length ? (cmp.reduce((s, r) => s + r.scores[k], 0) / cmp.length).toFixed(1) : "\u2014";
  return `# Idea Pulse \u2014 Trends

Averages (excluding baseline): Novelty ${avg("novelty")} \xB7 Idea strength ${avg("strength")} \xB7 Anxiety ${avg("anxiety")} \xB7 Analyses ${h.length}

| Date | Window | Notes | Words | Novelty | Strength | Anxiety | | Report |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}
function parseTime(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? [h, mi] : null;
}
function nextDue(lastRun, intervalDays, time, now) {
  const [h, m] = parseTime(time) || [9, 0];
  const base = new Date(lastRun ?? now);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (lastRun == null ? 0 : Math.max(1, Math.round(intervalDays))), h, m, 0, 0);
  return d.getTime();
}
function isDue(lastRun, intervalDays, time, now) {
  return now >= nextDue(lastRun, intervalDays, time, now);
}
var r1 = (x) => Math.round(x * 10) / 10;
function deltas(cur, prev) {
  if (!prev.length) return { vsPrevious: null, vsAverage: null, previousDate: null, analysesCompared: 0 };
  const last = prev[prev.length - 1];
  const keys = ["novelty", "strength", "anxiety"];
  const avg = (k) => prev.reduce((s, p) => s + p.scores[k], 0) / prev.length;
  const vp = {}, va = {};
  for (const k of keys) {
    vp[k] = r1(cur[k] - last.scores[k]);
    va[k] = r1(cur[k] - avg(k));
  }
  return { vsPrevious: vp, vsAverage: va, previousDate: last.date, analysesCompared: prev.length };
}
function buildLatest(o) {
  const { r, rec } = o;
  return {
    schema: 1,
    plugin: "idea-pulse",
    status: rec ? "ok" : "no_notes",
    trigger: o.trigger,
    date: o.date,
    windowDays: o.windowDays,
    notes: rec?.notes ?? 0,
    words: rec?.words ?? 0,
    baseline: rec?.baseline ?? false,
    scores: rec ? { ...rec.scores } : null,
    deltas: rec ? deltas(rec.scores, o.prev) : { vsPrevious: null, vsAverage: null, previousDate: null, analysesCompared: 0 },
    topInsights: (r?.insights || []).slice(0, 5).map((s) => String(s).slice(0, 400)),
    topConnections: (r?.connections || []).slice(0, 5).map((c) => ({ a: String(c.a), b: String(c.b), why: String(c.why).slice(0, 300) })),
    summary: String(r?.summary || "").slice(0, 1200),
    reportPath: rec?.reportPath ?? null,
    trendsPath: o.trendsPath,
    analysesTotal: o.analysesTotal,
    nextAutoRun: o.nextAutoRun == null ? null : new Date(o.nextAutoRun).toISOString()
  };
}

// src/main.ts
var DEFAULTS = {
  preset: "openai",
  ...PRESETS.openai,
  apiKey: "",
  scope: "all",
  scopeValue: "",
  windowDays: 3,
  reportFolder: "Idea Pulse",
  autoAnalyze: true,
  autoIntervalDays: 3,
  autoTime: "09:00"
};
var CHECK_EVERY_MS = 30 * 60 * 1e3;
var RETRY_AFTER_FAIL_MS = 3 * 3600 * 1e3;
var VIEW = "idea-pulse-chat";
var post = async (url, headers, body) => {
  const r = await (0, import_obsidian.requestUrl)({ url, method: "POST", headers, body, throw: false });
  if (r.status >= 400) throw new Error(`AI HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
};
var IdeaPulse = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.history = [];
    this.lastRunAt = null;
    this.lastAutoFailAt = null;
    this.running = false;
  }
  async onload() {
    const d = await this.loadData() || {};
    this.settings = Object.assign({}, DEFAULTS, d.settings);
    this.history = d.history || [];
    this.lastRunAt = d.lastRunAt ?? (this.history.length ? Date.parse(this.history[this.history.length - 1].date) : null);
    this.lastAutoFailAt = d.lastAutoFailAt ?? null;
    this.addRibbonIcon("activity", "Idea Pulse: analyze last N days", () => this.analyze());
    this.registerObsidianProtocolHandler("idea-pulse", async (params) => {
      const action = (params.action || "analyze").toLowerCase();
      if (action === "analyze") await this.analyze("uri");
      else if (action === "trends") await this.writeTrends(true);
      else new import_obsidian.Notice(`Idea Pulse: unknown action "${action}" (use action=analyze)`);
    });
    this.app.workspace.onLayoutReady(() => {
      void this.autoCheck();
    });
    this.registerInterval(window.setInterval(() => {
      void this.autoCheck();
    }, CHECK_EVERY_MS));
    this.addRibbonIcon("message-circle", "Idea Pulse: chat", () => this.openChat());
    this.addCommand({ id: "analyze", name: "Analyze last N days", callback: () => this.analyze() });
    this.addCommand({ id: "chat", name: "Open chat about recent notes", callback: () => this.openChat() });
    this.addCommand({ id: "trends", name: "Update trends note", callback: () => this.writeTrends(true) });
    this.registerView(VIEW, (l) => new ChatView(l, this));
    this.addSettingTab(new SettingsTab(this.app, this));
  }
  async save() {
    await this.saveData({ settings: this.settings, history: this.history, lastRunAt: this.lastRunAt, lastAutoFailAt: this.lastAutoFailAt });
  }
  nextAutoRun() {
    const s = this.settings;
    return s.autoAnalyze ? nextDue(this.lastRunAt, s.autoIntervalDays, s.autoTime, Date.now()) : null;
  }
  /** Runs the analysis once if the schedule says it's due (or overdue, e.g. Obsidian was closed). */
  async autoCheck(now = Date.now()) {
    const s = this.settings;
    if (!s.autoAnalyze || this.running) return false;
    if (!s.apiKey && s.preset !== "ollama") return false;
    if (this.lastAutoFailAt && now - this.lastAutoFailAt < RETRY_AFTER_FAIL_MS) return false;
    if (!isDue(this.lastRunAt, s.autoIntervalDays, s.autoTime, now)) return false;
    await this.analyze("auto");
    return true;
  }
  ai(messages, json = false) {
    const s = this.settings;
    if (!s.apiKey && s.preset !== "ollama") throw new Error("Set your API key in Settings \u2192 Idea Pulse");
    return chat(post, s.baseUrl, s.apiKey, s.model, messages, json);
  }
  inScope(f) {
    const s = this.settings;
    if (f.path.startsWith((0, import_obsidian.normalizePath)(s.reportFolder) + "/")) return false;
    if (s.scope === "folder") return !s.scopeValue || f.path.startsWith((0, import_obsidian.normalizePath)(s.scopeValue) + "/");
    if (s.scope === "tag") {
      const want = s.scopeValue.replace(/^#/, "").toLowerCase();
      const c = this.app.metadataCache.getFileCache(f);
      const tags = [...(c?.tags || []).map((t) => t.tag), ...[].concat(c?.frontmatter?.tags || [])].map((t) => String(t).replace(/^#/, "").toLowerCase());
      return tags.some((t) => t === want || t.startsWith(want + "/"));
    }
    return true;
  }
  async collect() {
    const since = Date.now() - this.settings.windowDays * 864e5;
    const out = [];
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
  async analyze(trigger = "manual") {
    if (this.running) {
      new import_obsidian.Notice("Idea Pulse: analysis already running");
      return;
    }
    this.running = true;
    const n = new import_obsidian.Notice(trigger === "manual" ? "Idea Pulse: analyzing\u2026" : `Idea Pulse: ${trigger === "auto" ? "scheduled" : "external"} analysis\u2026`, 0);
    try {
      const notes = await this.collect();
      if (!notes.length) {
        new import_obsidian.Notice(`Idea Pulse: no notes in the last ${this.settings.windowDays} days (check scope in settings).`);
        this.lastRunAt = Date.now();
        this.lastAutoFailAt = null;
        await this.save();
        await this.writeLatest(null, null, [], trigger, (/* @__PURE__ */ new Date()).toISOString());
        return;
      }
      const raw = await this.ai([{ role: "user", content: buildPrompt(notes, this.history) }], true);
      const r = normalize(parseJSON(raw));
      const now = /* @__PURE__ */ new Date();
      const date = now.toISOString();
      const folder = (0, import_obsidian.normalizePath)(this.settings.reportFolder);
      await this.ensureFolder(folder);
      const stem = `${folder}/Idea Pulse ${date.slice(0, 16).replace("T", " ").replace(":", "-")}`;
      let reportPath = (0, import_obsidian.normalizePath)(`${stem}.md`);
      for (let i = 2; this.app.vault.getAbstractFileByPath(reportPath); i++) reportPath = (0, import_obsidian.normalizePath)(`${stem} (${i}).md`);
      const rec = {
        id: date,
        date,
        windowDays: this.settings.windowDays,
        notes: notes.length,
        words: notes.reduce((s, x) => s + x.words, 0),
        scores: { novelty: r.overall.novelty, strength: r.overall.strength, anxiety: r.overall.anxiety },
        baseline: this.history.length === 0,
        reportPath
      };
      const prev = this.history.slice();
      const md = renderReport(r, rec, prev, new Map(notes.map((x) => [x.path, x.name])));
      const file = await this.app.vault.create(reportPath, md);
      this.history.push(rec);
      this.lastRunAt = now.getTime();
      this.lastAutoFailAt = null;
      await this.save();
      await this.writeTrends(false);
      await this.writeLatest(r, rec, prev, trigger, date);
      if (trigger === "manual") await this.app.workspace.getLeaf(true).openFile(file);
      new import_obsidian.Notice(trigger === "manual" ? "Idea Pulse: report ready" : `Idea Pulse: new report \u2014 ${file.basename}`);
    } catch (e) {
      if (trigger !== "manual") {
        this.lastAutoFailAt = Date.now();
        await this.save();
      }
      new import_obsidian.Notice("Idea Pulse error: " + e.message, 8e3);
      console.error(e);
    } finally {
      n.hide();
      this.running = false;
    }
  }
  /** Small machine-readable summary for other tools: scores, deltas, top insights. Never contains note text. */
  async writeLatest(r, rec, prev, trigger, date) {
    const folder = (0, import_obsidian.normalizePath)(this.settings.reportFolder);
    await this.ensureFolder(folder);
    const latest = buildLatest({
      r,
      rec,
      prev,
      trigger,
      date,
      windowDays: this.settings.windowDays,
      trendsPath: (0, import_obsidian.normalizePath)(`${folder}/Trends.md`),
      analysesTotal: this.history.length,
      nextAutoRun: this.nextAutoRun()
    });
    await this.app.vault.adapter.write((0, import_obsidian.normalizePath)(`${folder}/latest.json`), JSON.stringify(latest, null, 2));
  }
  async writeTrends(open) {
    const folder = (0, import_obsidian.normalizePath)(this.settings.reportFolder);
    await this.ensureFolder(folder);
    const p = (0, import_obsidian.normalizePath)(`${folder}/Trends.md`);
    const md = renderTrends(this.history);
    const f = this.app.vault.getAbstractFileByPath(p);
    const file = f instanceof import_obsidian.TFile ? (await this.app.vault.modify(f, md), f) : await this.app.vault.create(p, md);
    if (open) await this.app.workspace.getLeaf(true).openFile(file);
  }
  async ensureFolder(p) {
    if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);
  }
  async openChat() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
};
var ChatView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.msgs = [];
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "Idea Pulse chat";
  }
  getIcon() {
    return "message-circle";
  }
  async onOpen() {
    const c = this.contentEl;
    c.empty();
    c.addClass("idea-pulse-chat");
    c.createEl("div", { cls: "ip-hint", text: `Ask about notes from the last ${this.plugin.settings.windowDays} days, e.g. "Is there a connection between X and Y?"` });
    this.log = c.createDiv("ip-log");
    const form = c.createEl("form", { cls: "ip-form" });
    const ta = form.createEl("textarea", { attr: { placeholder: "Ask\u2026", rows: "3" } });
    form.createEl("button", { text: "Send", attr: { type: "submit" } });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const q = ta.value.trim();
      if (q) {
        ta.value = "";
        await this.ask(q);
      }
    };
  }
  async add(role, text) {
    const el = this.log.createDiv(`ip-msg ip-${role}`);
    await import_obsidian.MarkdownRenderer.render(this.app, text, el, "", this);
    this.log.scrollTop = this.log.scrollHeight;
    return el;
  }
  async ask(q) {
    await this.add("user", q);
    const wait = this.log.createDiv({ cls: "ip-msg ip-wait", text: "\u2026" });
    try {
      if (!this.msgs.length) {
        const notes = await this.plugin.collect();
        const ctx = notes.map((n) => `### [[${n.name}]]
${n.text.slice(0, Math.floor(6e4 / Math.max(1, notes.length)))}`).join("\n\n");
        this.msgs.push({ role: "system", content: `You help the user think about their recent notes. Answer in the user's language, concisely, citing notes as [[Note name]] wikilinks. Notes from the last ${this.plugin.settings.windowDays} days:

${ctx || "(no notes)"}` });
      }
      this.msgs.push({ role: "user", content: q });
      const a = await this.plugin.ai(this.msgs);
      this.msgs.push({ role: "assistant", content: a });
      wait.remove();
      await this.add("assistant", a);
    } catch (e) {
      wait.setText("Error: " + e.message);
      this.msgs.pop();
    }
  }
};
var SettingsTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl: c } = this;
    c.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.save();
    new import_obsidian.Setting(c).setName("AI provider").setDesc("Any OpenAI-compatible endpoint. Choosing a preset fills URL and model.").addDropdown((d) => d.addOptions({ openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", ollama: "Ollama (local)", custom: "Custom" }).setValue(s.preset).onChange(async (v) => {
      s.preset = v;
      if (PRESETS[v]) Object.assign(s, PRESETS[v]);
      await save();
      this.display();
    }));
    new import_obsidian.Setting(c).setName("Base URL").addText((t) => t.setValue(s.baseUrl).onChange(async (v) => {
      s.baseUrl = v.trim();
      await save();
    }));
    new import_obsidian.Setting(c).setName("API key").setDesc("Stored in this vault's plugin data. Not needed for Ollama.").addText((t) => {
      t.inputEl.type = "password";
      t.setValue(s.apiKey).onChange(async (v) => {
        s.apiKey = v.trim();
        await save();
      });
    });
    new import_obsidian.Setting(c).setName("Model").addText((t) => t.setValue(s.model).onChange(async (v) => {
      s.model = v.trim();
      await save();
    }));
    new import_obsidian.Setting(c).setName("Source scope").setDesc("Which notes to analyze: all, one folder (e.g. Home), or a tag.").addDropdown((d) => d.addOptions({ all: "All notes", folder: "Folder", tag: "Tag" }).setValue(s.scope).onChange(async (v) => {
      s.scope = v;
      await save();
      this.display();
    }));
    if (s.scope !== "all") new import_obsidian.Setting(c).setName(s.scope === "folder" ? "Folder path" : "Tag").addText((t) => t.setPlaceholder(s.scope === "folder" ? "Home" : "#idea").setValue(s.scopeValue).onChange(async (v) => {
      s.scopeValue = v.trim();
      await save();
    }));
    new import_obsidian.Setting(c).setName("Window (days)").addText((t) => t.setValue(String(s.windowDays)).onChange(async (v) => {
      const n = parseInt(v);
      if (n > 0) {
        s.windowDays = n;
        await save();
      }
    }));
    c.createEl("h3", { text: "Auto-analyze" });
    const next = this.plugin.nextAutoRun();
    new import_obsidian.Setting(c).setName("Auto-analyze").setDesc(`Runs the analysis inside Obsidian on a schedule. Checked on startup and every 30 min; a missed run (Obsidian was closed) runs once on next start.${next ? " Next: " + new Date(next).toLocaleString() : ""}`).addToggle((t) => t.setValue(s.autoAnalyze).onChange(async (v) => {
      s.autoAnalyze = v;
      await save();
      this.display();
    }));
    if (s.autoAnalyze) {
      new import_obsidian.Setting(c).setName("Every N days").addText((t) => t.setValue(String(s.autoIntervalDays)).onChange(async (v) => {
        const n = parseInt(v);
        if (n > 0) {
          s.autoIntervalDays = n;
          await save();
        }
      }));
      new import_obsidian.Setting(c).setName("Time of day").setDesc("24h, HH:MM").addText((t) => {
        t.inputEl.type = "time";
        t.setValue(s.autoTime).onChange(async (v) => {
          if (parseTime(v)) {
            s.autoTime = v;
            await save();
          }
        });
      });
    }
    new import_obsidian.Setting(c).setName("External trigger").setDesc("obsidian://idea-pulse?action=analyze \u2014 lets a scheduler start the analysis in Obsidian. Results: <report folder>/latest.json");
    new import_obsidian.Setting(c).setName("Report folder").addText((t) => t.setValue(s.reportFolder).onChange(async (v) => {
      s.reportFolder = v.trim() || "Idea Pulse";
      await save();
    }));
    new import_obsidian.Setting(c).setName("Analyses stored").setDesc(`${this.plugin.history.length} in history`).addButton((b) => b.setButtonText("Test connection").onClick(async () => {
      try {
        await this.plugin.ai([{ role: "user", content: "Reply with OK" }]);
        new import_obsidian.Notice("Idea Pulse: connection OK");
      } catch (e) {
        new import_obsidian.Notice("Failed: " + e.message, 8e3);
      }
    }));
  }
};
