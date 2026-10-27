# Spotify Stats

A look at ten years of my Spotify listening — and yours, if you load your own data.
Plain HTML, CSS and JavaScript: no framework, no build step, no server.

## View it

Open `web/index.html` in a browser.

You'll see my history by default. Click **Load your own Spotify data** at the top (or drop the zip
onto the page) to see yours instead. It's processed in your browser and saved there only — nothing
is uploaded. **Remove my data** switches back.

## What's on the page

- Listening time per month: drag across it to pick any period; everything below follows.
- Top artists and songs; top artists over time (rank lines per year / quarter / month).
- New vs. familiar: each month's listening split into songs new to you and songs you already knew.
- Skips: where in a song you skip, most-skipped songs.
- Distributions: daily listening, plays per song, how much of each song you hear, song lengths.
- How you listen: devices, how songs started (picked / autoplayed / skipped to), shuffle, offline, private sessions.
- When you listen: every day of the period against time of day, in 15-minute blocks.
- Listening calendar: day-by-day grid per year, streaks, biggest day.
- Retention over time: share of song time actually heard, weighted by hours listened.
- Your library: search, a filter panel (ranges for plays, time, skip rate, avg heard, dates…),
  saved presets, songs / artists / albums views, CSV export, full screen, keyboard navigation.
  Open a song for its history and a Spotify preview player.
- The address bar keeps the library's filters, so Back/Forward step through them and views can be bookmarked.

## Getting Spotify data

On spotify.com: **Account → Privacy settings → Download your data**, and request
**Extended streaming history** (your full history; arrives by email, can take a few weeks).
"Account data" also works but covers only about the last year, without skip details.

## Updating the default data (mine)

```
python3 build.py "path/to/Spotify Extended Streaming History" --name Default
```

This rewrites `web/data.js`. Options: `--tz` (default `America/Chicago`) and `--out`.
`web/import.js` runs the same processing in the browser for uploaded data; if you change how
stats are calculated, change both (they currently produce identical output).

## Files

| File | What it does |
|---|---|
| `build.py` | Spotify export → `web/data.js` |
| `web/index.html`, `web/style.css` | The page |
| `web/loader.js` | Uses data loaded in this browser if there is any, otherwise `data.js`; then starts the app |
| `web/app.js` | All charts, the library table and filters |
| `web/import.js` | Load-your-own-data: unzip + process in the browser, store it locally |
| `web/data.js` | My processed listening history (songs, counts and times only — no IP addresses or account details) |

## How some numbers are worked out

- **Song length** isn't in Spotify's export: it's the longest play of that song that ran to the end.
  Songs never played to the end have no known length and are left out of retention.
- **Skips**: a play counts as skipped if Spotify marked it, or it ended with next, back, or picking
  something else. Spotify's own flag is always false before late 2022, so this keeps years comparable.
- **Dates** use when a play started, in your time zone.
- **Devices** are grouped from Spotify's platform text (e.g. "Android OS 10 API 29 (OnePlus…)" → Android);
  the same rules live in `build.py` and `web/import.js`.
