# Idea Pulse (Obsidian plugin) v0.2.0

AI analysis of your last N days of notes: insights, connections, novelty / idea strength / anxiety scores, trends, chat, and auto-analyze. All note reading and AI analysis happens **inside Obsidian** — nothing outside the vault reads your notes.

Works on desktop and mobile (`isDesktopOnly: false`).

## Install on iPad / iPhone (BRAT)

1. In Obsidian → **Settings → Community plugins** → turn on Community plugins → **Browse** → install and enable **BRAT** (by TfTHacker).
2. Open **Settings → BRAT** → **Add beta plugin**.
3. Paste: `https://github.com/xgrybvo6508-dot/obsidian-idea-pulse`
4. Enable **Idea Pulse** in Community plugins.
5. **Settings → Idea Pulse**: choose a provider and paste your API key → **Test connection**.

BRAT installs from the latest GitHub release (tag = version in `manifest.json`).

## Install on desktop (manual)

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/idea-pulse/`, then enable the plugin.

## Auto-analyze

Settings → Idea Pulse → Auto-analyze (on by default): every **3 days** at **09:00** (both configurable).
The plugin checks on startup and every 30 min. If a run was missed (Obsidian was closed), it runs once on next start.
It stays silent until an API key is set; after a failed auto run it waits 3 h before retrying.

## External trigger

`obsidian://idea-pulse?action=analyze` (add `&vault=<Vault name>` if you have several vaults).
This only asks Obsidian to run the analysis; the plugin reads and analyzes the notes itself. `action=trends` opens the Trends note.

## Results for other tools

After each analysis: `<Report folder>/latest.json` (default `Idea Pulse/latest.json`):
`date`, `trigger` (manual/auto/uri), `status` (ok/no_notes), `notes`, `words`, `scores` {novelty, strength, anxiety},
`deltas` {vsPrevious, vsAverage, previousDate}, `topInsights` (≤5), `topConnections` (≤5, note names only), short AI `summary`,
`reportPath`, `nextAutoRun`. It never contains note text.

## Build

```bash
npm install && npm run build
```
