import esbuild from "esbuild"; import assert from "node:assert/strict"; import { createRequire } from "node:module";
import path from "node:path"; import fs from "node:fs";
const dir = path.dirname(new URL(import.meta.url).pathname); const out = path.join(dir, ".build/plugin.cjs");
await esbuild.build({ entryPoints: [path.join(dir, "entry.ts")], bundle: true, outfile: out, format: "cjs", platform: "node",
  alias: { obsidian: path.join(dir, "obsidian-mock.ts") }, logLevel: "error" });
globalThis.window = { setInterval: (f, ms) => { assert.equal(ms, 30 * 60 * 1000); return 42; } };
const { Plugin: IdeaPulse, mock, core } = createRequire(import.meta.url)(out);
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };

// --- scheduling logic
const T = (s) => new Date(s).getTime();
ok(core.isDue(null, 3, "09:00", T("2026-10-07T09:30")), "never run + past time today → due");
ok(!core.isDue(null, 3, "09:00", T("2026-10-07T08:00")), "never run + before time → not due");
ok(!core.isDue(T("2026-10-07T09:01"), 3, "09:00", T("2026-10-09T23:00")), "ran Oct 7 → not due Oct 9");
ok(core.isDue(T("2026-10-07T09:01"), 3, "09:00", T("2026-10-10T09:00")), "due Oct 10 09:00");
ok(core.isDue(T("2026-10-01T09:01"), 3, "09:00", T("2026-10-12T07:00")), "overdue (Obsidian closed) → due once");
ok(core.parseTime("25:00") === null && core.parseTime("7:05")[1] === 5, "time parsing");

// --- plugin end-to-end with fake vault + fake AI
const now = Date.now(); const SECRET = "SECRET_NOTE_BODY_TEXT_xyz";
const app = mock.makeApp({ "Home/Idea A.md": { text: "Idea A about agile reviews " + SECRET, t: now - 3600e3 },
  "Home/Idea B.md": { text: "Idea B anxious about deadlines", t: now - 2 * 86400e3 }, "Old.md": { text: "old", t: now - 10 * 86400e3 } });
let score = 5;
mock.setAI(body => { const u = body.messages[0].content; assert.ok(u.includes("Idea A")); assert.ok(!u.includes("old\n"));
  return { choices: [{ message: { content: JSON.stringify({ language: "en", summary: "Two ideas.", insights: ["i1", "i2", "i3", "i4", "i5", "i6"],
    connections: [{ a: "Idea A", b: "Idea B", why: "both about time" }],
    notes: [{ path: "Home/Idea A.md", novelty: score, strength: 6, anxiety: 2, reason: "r" }], overall: { novelty: score, strength: 6, anxiety: 3, reason: "x" } }) } }] }; });
const p = new IdeaPulse(app); await p.onload();
const c = mock.calls;
ok(c.intervals.includes(42) && c.layoutReady.length === 1 && typeof c.uri["idea-pulse"] === "function", "registers 30-min interval, layout-ready check, obsidian://idea-pulse handler");
ok(p.settings.autoAnalyze === true && p.settings.autoIntervalDays === 3 && p.settings.autoTime === "09:00", "defaults: auto on, every 3 days, 09:00");
ok(await p.autoCheck(T("2026-10-07T10:00")) === false && c.posts.length === 0, "no API key → auto stays silent, no AI call");
p.settings.apiKey = "k"; p.settings.autoTime = "00:00";
await c.layoutReady[0](); await new Promise(r => setTimeout(r, 10));
ok(p.history.length === 1 && p.history[0].baseline, "startup check: due → ran once (baseline)");
const latestPath = "Idea Pulse/latest.json"; let L = JSON.parse(app.raw.get(latestPath));
ok(L.status === "ok" && L.trigger === "auto" && L.baseline && L.deltas.vsPrevious === null && L.scores.novelty === 5, "latest.json written (baseline, no deltas)");
ok(L.topInsights.length === 5 && L.nextAutoRun, "latest.json: top 5 insights + nextAutoRun");
ok(!app.raw.get(latestPath).includes(SECRET) && !app.raw.get(latestPath).includes("deadlines"), "latest.json contains no note text");
ok(c.opened.length === 0, "auto run doesn't steal focus");
ok(await p.autoCheck() === false && p.history.length === 1, "not due again right after");
ok(await p.autoCheck(Date.now() + 3 * 86400e3 + 60e3) === true && p.history.length === 2, "due again after 3 days");
score = 8; await c.uri["idea-pulse"]({ action: "analyze" });
L = JSON.parse(app.raw.get(latestPath));
ok(p.history.length === 3 && L.trigger === "uri" && L.deltas.vsPrevious.novelty === 3 && L.deltas.analysesCompared === 2, "URI action=analyze runs analysis; deltas vs previous");
ok(app.raw.get("Idea Pulse/Trends.md").includes("baseline"), "Trends updated");
await c.uri["idea-pulse"]({ action: "bogus" }); ok(c.notices.some(n => n.includes("unknown action")), "unknown URI action → notice, no run");
// failure backoff
mock.setAI(() => ({ error: "boom" })); const before = c.posts.length;
p.lastRunAt = Date.now() - 10 * 86400e3;
await p.autoCheck(); ok(p.lastAutoFailAt && p.history.length === 3, "auto failure recorded");
await p.autoCheck(); ok(c.posts.length === before + 1, "no retry within 3h after a failed auto run");
p.settings.autoAnalyze = false; p.lastAutoFailAt = null; ok(await p.autoCheck() === false, "auto off → never runs");
// persistence
const p2 = new IdeaPulse(app); p2.data = p.data; await p2.onload(); ok(p2.lastRunAt === p.lastRunAt && p2.settings.autoTime === "00:00", "schedule state persists");
console.log(`\n${pass} checks passed`);
