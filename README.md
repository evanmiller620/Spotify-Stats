# Spotify Stats

A look at ten years of my Spotify listening — and yours, if you load your own data.
Plain HTML, CSS and JavaScript: no framework, no build step, no server.

## View it

Open `web/index.html` in a browser.

You'll see my history by default. Click **Load your own Spotify data** at the top (or drop the zip
onto the page) to see yours instead. It's processed in your browser and saved there only — nothing
is uploaded unless you open **Friends** (below). **Remove my data** switches back.

## Friends

**Friends** (top of the page) opens a separate view; the main charts don't change.

- **Your link**: opening Friends uploads the summary behind the page (the same data the charts use,
  not your raw Spotify files) if it isn't on the server already, and gives you a link. If your data has
  changed since, it re-uploads to the same link. Anyone with the link can open your stats. You can change
  the name friends see; **Stop sharing** blanks it, the link stops working, and Friends won't share again
  until you click **Share again**. Only the browser that shared can rename or stop it.
  Someone looking at the default data isn't shared; they're asked to load their own first.
- **Add a friend** by pasting their link. Opening someone's link also adds them.
- **Compare** up to 5 friends at once: tick them on the friends cards (the selection is in the address,
  so you can bookmark a group). For all time or one year you get: taste match (one number for two people,
  an everyone-vs-everyone grid for more; how much of each person's listening time goes to the same artists,
  using each person's top 150), awards (biggest listener, explorer, superfan, most patient, night owl,
  early bird, completionist), head-to-head bars, listening by month, a 24-hour listening clock, a dot grid
  of who listens to the group's top artists, each person's signature artists, and songs in common.
  Also: **your group's Wrapped** (a few slides to click through), **who found it first** (shared songs:
  who played them first and how long the others took) and **who started after whom** (artists one of you
  picked up within six months after another).
- **Make a playlist**: Blend (songs you have in common, then everyone's favorites taking turns),
  everyone's top songs, discover (friends' favorites you've barely played), or one person's top songs,
  recent repeats or forgotten favorites. 25, 50 or 100 songs. **Save to Spotify** puts it in your account
  (see below); **Copy song links** works anywhere: paste into a playlist in the Spotify desktop app.
- **A friend's link** opens their full stats with a summary at the top (totals, top artists, taste match
  with you) and a playlist maker for their songs.

Shared stats are stored in Supabase (project Overthrow-game, tables `spotify_stats_shares` and
`spotify_stats_chunks`). The tables can't be read directly; the page only uses the `spotify_stats_*`
functions, which need the share's code to read and its secret token to change.

## Saving playlists to Spotify

Saving needs a (free) Spotify developer app, and the site has to be opened from its web address
(`https://…`, or `http://127.0.0.1:<port>` while testing on your computer). From a file it can only copy links.

1. Go to developer.spotify.com/dashboard → **Create app**. Any name and description.
2. **Redirect URI**: the exact address of the page, e.g. `https://you.github.io/Spotify-Stats/web/index.html`.
   Tick **Web API**. Save.
3. Copy the **Client ID** into `web/spotify.js` (`const CLIENT_ID = '…'`). It isn't a secret.
4. In the app's **User Management**, add each friend's Spotify email. Spotify only lets an app in
   development mode work for its owner plus a handful of added users (5 at the moment), and the owner
   needs Spotify Premium.

People sign in with Spotify the first time they save; after that it saves straight away. Playlists are
created as private.

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
- This month in past years: your top songs in this month 1, 3 and 5 years ago.
- Stories:
  - Obsessions: songs you binged (most plays packed into 1–3 months), and whether they faded.
  - Taste drift: how much of each year went to last year's top 50 artists; who joined and left your top 10.
  - Discovery: new artists per month, best finds, and how many of each year's finds you still play.
  - Streaks: longest run of days with music, current streak, longest break.
  - Song length: share of plays by song length, and how often you skip songs of each length.
  - Deep cuts vs. one-song artists: artists you've played the most songs by, and the one song you play by others.
  - Grew on you / wore out: songs whose skip rate fell or rose a lot between their early and later plays.
  - How each artist gets played: picked, autoplayed or skipped to, and how much on shuffle (all time).
- Your library: search, a filter panel (ranges for plays, time, skip rate, avg heard, dates…),
  saved presets, songs / artists / albums views, CSV export, full screen, keyboard navigation.
  Open a song for its history; **Play** plays it in a mini player in the corner that keeps going while you browse.
- The address bar keeps the library's filters, so Back/Forward step through them and views can be bookmarked.

## Getting Spotify data

On spotify.com: **Account → Privacy settings → Download your data**, and request
**Extended streaming history** (your full history; arrives by email, can take a few weeks).
"Account data" also works but covers only about the last year, without skip details.

## Updating the default data (mine)

```
python3 build.py "path/to/Spotify Extended Streaming History" --name Default
```

This rewrites `web/data.js`. Options: `--tz` (default `America/Chicago`), `--out`, and `--edits` (below).
`web/import.js` runs the same processing in the browser for uploaded data; if you change how
stats are calculated, change both (they currently produce identical output).

## Editing the numbers by hand

The data files are too big to edit as text, so there's an editor: open `tools/editor.html` in Chrome or Edge,
click **Open project folder…**, pick this folder and the data file. Search for a song, then change its plays,
minutes or skips for any month (or add a month). Changing plays moves minutes along at the song's usual
minutes per play unless you type the minutes yourself.

**Save** rewrites the data file and keeps your changes in `edits/<file>.json`, a small readable list.
Rebuilding from a new Spotify export would otherwise lose them, so pass that file to the build:

```
python3 build.py "path/to/Spotify Extended Streaming History" --name Default --edits edits/data.json
```

Edits change plays, time and skips everywhere they're counted (totals, top lists, library, trends, skip stats).
The day-by-day charts (calendar, time of day, daily listening) and devices come from separate day totals and
don't change. In other browsers the editor opens a single file and Save downloads both files instead.

## Files

| File | What it does |
|---|---|
| `build.py` | Spotify export → `web/data.js` |
| `tools/editor.html` | Edit plays / time / skips in a data file; saves the file and `edits/<file>.json` |
| `edits/` | Hand edits, re-applied with `build.py --edits` |
| `web/index.html`, `web/style.css` | The page |
| `web/loader.js` | Uses data loaded in this browser if there is any, otherwise `data.js`; then starts the app |
| `web/app.js` | All charts, the library table and filters |
| `web/import.js` | Load-your-own-data: unzip + process in the browser, store it locally |
| `web/cloud.js` | Sharing: uploads/downloads shared stats through the Supabase functions |
| `web/friends.js` | The Friends view (share link, friends, group compare) and the top of a friend's shared page |
| `web/playlists.js` | Playlist maker |
| `web/spotify.js` | Sign in with Spotify and save playlists (set `CLIENT_ID` here) |
| `web/data.js` | My processed listening history (songs, counts and times only — no IP addresses or account details) |

## How some numbers are worked out

- **Song length** isn't in Spotify's export: it's the longest play of that song that ran to the end.
  Songs never played to the end have no known length and are left out of retention.
- **Skips**: a play counts as skipped if Spotify marked it, or it ended with next, back, or picking
  something else. Spotify's own flag is always false before late 2022, so this keeps years comparable.
- **Dates** use when a play started, in your time zone.
- **Devices** are grouped from Spotify's platform text (e.g. "Android OS 10 API 29 (OnePlus…)" → Android);
  the same rules live in `build.py` and `web/import.js`.
