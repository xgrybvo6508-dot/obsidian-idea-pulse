// Pure logic (no Obsidian imports) so it can be tested in node.
export interface Scores { novelty: number; strength: number; anxiety: number; }
export interface NoteScore extends Scores { path: string; reason: string; }
export interface AnalysisRecord {
  id: string; date: string; windowDays: number; notes: number; words: number;
  scores: Scores; baseline: boolean; reportPath: string;
}
export interface AIResult {
  language: string; summary: string; insights: string[];
  connections: { a: string; b: string; why: string }[];
  notes: NoteScore[]; overall: Scores & { reason: string };
}
export interface NoteInput { path: string; name: string; text: string; words: number; }

export const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
};

export type Poster = (url: string, headers: Record<string, string>, body: string) => Promise<any>;

export async function chat(post: Poster, baseUrl: string, apiKey: string, model: string,
  messages: { role: string; content: string }[], json = false): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (baseUrl.includes("anthropic.com")) { headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; }
  const body: any = { model, messages, temperature: 0.4 };
  if (json && !baseUrl.includes("anthropic.com")) body.response_format = { type: "json_object" };
  const res = await post(baseUrl.replace(/\/+$/, "") + "/chat/completions", headers, JSON.stringify(body));
  const c = res?.choices?.[0]?.message?.content;
  if (typeof c !== "string") throw new Error("Unexpected AI response: " + JSON.stringify(res).slice(0, 300));
  return c;
}

export function countWords(t: string): number { return (t.match(/[\p{L}\p{N}]+/gu) || []).length; }

const DATE_RE = /(\d{4})[-_.](\d{2})[-_.](\d{2})/;
export function dateFromName(name: string): number | null {
  const m = name.match(DATE_RE); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]).getTime(); return isNaN(d) ? null : d;
}

export function buildPrompt(notes: NoteInput[], prev: AnalysisRecord[], maxChars = 60000): string {
  const per = Math.max(800, Math.floor(maxChars / Math.max(1, notes.length)));
  const body = notes.map(n => `### [[${n.name}]] (path: ${n.path})\n${n.text.slice(0, per)}`).join("\n\n");
  const hist = prev.slice(-5)
    .map(p => `${p.date}: novelty ${p.scores.novelty}, strength ${p.scores.strength}, anxiety ${p.scores.anxiety}`).join("\n");
  return `You analyze a person's recent notes and ideas. Answer in the SAME language as the notes.
Return ONLY JSON:
{"language":"ru|en|...","summary":"3-6 sentences","insights":["new insight derived by combining notes", ...],
"connections":[{"a":"note name","b":"note name","why":"one line"}],
"notes":[{"path":"exact path","novelty":0-10,"strength":0-10,"anxiety":0-10,"reason":"one line"}],
"overall":{"novelty":0-10,"strength":0-10,"anxiety":0-10,"reason":"one line"}}
Novelty = how new the ideas are vs typical/earlier thinking. Strength = how strong, actionable and adaptable the ideas are. Anxiety = how anxious/stressed the tone is (0 calm, 10 very anxious).
Previous analyses (for context):\n${hist || "none"}\n\nNOTES:\n${body}`;
}

export function parseJSON<T>(s: string): T {
  const m = s.match(/\{[\s\S]*\}/); if (!m) throw new Error("AI did not return JSON");
  return JSON.parse(m[0]);
}

const clamp = (x: any) => Math.max(0, Math.min(10, Math.round(Number(x) * 10) / 10 || 0));
export function normalize(r: AIResult): AIResult {
  r.insights ||= []; r.connections ||= []; r.notes ||= [];
  r.notes.forEach(n => { n.novelty = clamp(n.novelty); n.strength = clamp(n.strength); n.anxiety = clamp(n.anxiety); });
  r.overall = { novelty: clamp(r.overall?.novelty), strength: clamp(r.overall?.strength), anxiety: clamp(r.overall?.anxiety), reason: r.overall?.reason || "" };
  return r;
}

const fmt = (d: number) => (d > 0 ? "+" : "") + d.toFixed(1);
const arrow = (d: number) => (d > 0.25 ? "↑" : d < -0.25 ? "↓" : "→");

/** Compare against previous non-baseline-only history. First record ever = baseline. */
export function compare(cur: Scores, prev: AnalysisRecord[]): string {
  if (!prev.length) return "_Baseline analysis — not used for comparison; next reports will compare against it._";
  const last = prev[prev.length - 1];
  const avg = (k: keyof Scores) => prev.reduce((s, p) => s + p.scores[k], 0) / prev.length;
  const rows = (["novelty", "strength", "anxiety"] as (keyof Scores)[]).map(k => {
    const d = cur[k] - last.scores[k]; const da = cur[k] - avg(k);
    return `| ${label(k)} | ${cur[k]} | ${last.scores[k]} | ${fmt(d)} ${arrow(d)} | ${fmt(da)} ${arrow(da)} |`;
  });
  return `| Metric | Now | Previous | Δ prev | Δ avg (${prev.length}) |\n|---|---|---|---|---|\n${rows.join("\n")}`;
}
export const label = (k: keyof Scores) => ({ novelty: "Novelty", strength: "Idea strength", anxiety: "Anxiety" })[k];

export function renderReport(r: AIResult, rec: AnalysisRecord, prev: AnalysisRecord[], names: Map<string, string>): string {
  const link = (p: string) => `[[${names.get(p) ?? p.replace(/\.md$/, "")}]]`;
  const fm = ["---", `idea_pulse: true`, `date: ${rec.date}`, `window_days: ${rec.windowDays}`, `notes: ${rec.notes}`, `words: ${rec.words}`,
    `novelty: ${rec.scores.novelty}`, `strength: ${rec.scores.strength}`, `anxiety: ${rec.scores.anxiety}`, `baseline: ${rec.baseline}`, "---"].join("\n");
  return `${fm}
# Idea Pulse — ${rec.date.slice(0, 10)}

**Window:** last ${rec.windowDays} days · **Volume of work:** ${rec.notes} notes, ${rec.words} words

## Summary
${r.summary}

## New insights
${r.insights.map(i => `- ${i}`).join("\n") || "- —"}

## Connections
${r.connections.map(c => `- [[${c.a}]] ↔ [[${c.b}]] — ${c.why}`).join("\n") || "- —"}

## Scores (0–10)
| | Novelty | Idea strength | Anxiety |
|---|---|---|---|
| **Overall** | ${r.overall.novelty} | ${r.overall.strength} | ${r.overall.anxiety} |

${r.overall.reason}

### Per note
| Note | Nov | Str | Anx | Why |
|---|---|---|---|---|
${r.notes.map(n => `| ${link(n.path)} | ${n.novelty} | ${n.strength} | ${n.anxiety} | ${(n.reason || "").replace(/\|/g, "/")} |`).join("\n")}

## Compared to previous analyses
${compare(rec.scores, prev)}
`;
}

export function renderTrends(h: AnalysisRecord[]): string {
  const rows = h.map(r => `| ${r.date.slice(0, 10)} | ${r.windowDays}d | ${r.notes} | ${r.words} | ${r.scores.novelty} | ${r.scores.strength} | ${r.scores.anxiety} | ${r.baseline ? "baseline" : ""} | [[${r.reportPath.replace(/\.md$/, "")}\\|report]] |`);
  const cmp = h.filter(r => !r.baseline);
  const avg = (k: keyof Scores) => cmp.length ? (cmp.reduce((s, r) => s + r.scores[k], 0) / cmp.length).toFixed(1) : "—";
  return `# Idea Pulse — Trends

Averages (excluding baseline): Novelty ${avg("novelty")} · Idea strength ${avg("strength")} · Anxiety ${avg("anxiety")} · Analyses ${h.length}

| Date | Window | Notes | Words | Novelty | Strength | Anxiety | | Report |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

// ---------- Scheduling (auto-analyze) ----------
/** Parse "HH:MM" (24h). Returns [h, m] or null. */
export function parseTime(s: string): [number, number] | null {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/); if (!m) return null;
  const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? [h, mi] : null;
}
/** Next scheduled run (ms, local time). Never run → today at `time`. Otherwise the day of last run + intervalDays at `time`. */
export function nextDue(lastRun: number | null, intervalDays: number, time: string, now: number): number {
  const [h, m] = parseTime(time) || [9, 0];
  const base = new Date(lastRun ?? now);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (lastRun == null ? 0 : Math.max(1, Math.round(intervalDays))), h, m, 0, 0);
  return d.getTime();
}
/** Due if the scheduled moment has passed (also covers overdue runs, e.g. Obsidian was closed). */
export function isDue(lastRun: number | null, intervalDays: number, time: string, now: number): boolean {
  return now >= nextDue(lastRun, intervalDays, time, now);
}

// ---------- Machine-readable summary (no note text) ----------
export interface Latest {
  schema: 1; plugin: "idea-pulse"; status: "ok" | "no_notes"; trigger: string; date: string;
  windowDays: number; notes: number; words: number; baseline: boolean;
  scores: Scores | null; deltas: { vsPrevious: Scores | null; vsAverage: Scores | null; previousDate: string | null; analysesCompared: number };
  topInsights: string[]; topConnections: { a: string; b: string; why: string }[]; summary: string;
  reportPath: string | null; trendsPath: string; analysesTotal: number; nextAutoRun: string | null;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
export function deltas(cur: Scores, prev: AnalysisRecord[]) {
  if (!prev.length) return { vsPrevious: null, vsAverage: null, previousDate: null, analysesCompared: 0 };
  const last = prev[prev.length - 1]; const keys = ["novelty", "strength", "anxiety"] as (keyof Scores)[];
  const avg = (k: keyof Scores) => prev.reduce((s, p) => s + p.scores[k], 0) / prev.length;
  const vp = {} as Scores, va = {} as Scores;
  for (const k of keys) { vp[k] = r1(cur[k] - last.scores[k]); va[k] = r1(cur[k] - avg(k)); }
  return { vsPrevious: vp, vsAverage: va, previousDate: last.date, analysesCompared: prev.length };
}
export function buildLatest(o: { r: AIResult | null; rec: AnalysisRecord | null; prev: AnalysisRecord[]; trigger: string; date: string;
  windowDays: number; trendsPath: string; analysesTotal: number; nextAutoRun: number | null }): Latest {
  const { r, rec } = o;
  return {
    schema: 1, plugin: "idea-pulse", status: rec ? "ok" : "no_notes", trigger: o.trigger, date: o.date,
    windowDays: o.windowDays, notes: rec?.notes ?? 0, words: rec?.words ?? 0, baseline: rec?.baseline ?? false,
    scores: rec ? { ...rec.scores } : null,
    deltas: rec ? deltas(rec.scores, o.prev) : { vsPrevious: null, vsAverage: null, previousDate: null, analysesCompared: 0 },
    topInsights: (r?.insights || []).slice(0, 5).map(s => String(s).slice(0, 400)),
    topConnections: (r?.connections || []).slice(0, 5).map(c => ({ a: String(c.a), b: String(c.b), why: String(c.why).slice(0, 300) })),
    summary: String(r?.summary || "").slice(0, 1200),
    reportPath: rec?.reportPath ?? null, trendsPath: o.trendsPath, analysesTotal: o.analysesTotal,
    nextAutoRun: o.nextAutoRun == null ? null : new Date(o.nextAutoRun).toISOString(),
  };
}
