"""Turn your Spotify Extended Streaming History into web/data.js.

Usage:
    python3 build.py path/to/Spotify_Extended_Streaming_History [--tz America/Chicago]

Then open web/index.html in a browser. No server or npm needed.

Retention: Spotify's export doesn't include song lengths, so each song's length is
taken as its longest play that ended with the track finishing ("trackdone").
Songs you never played to the end have no known length and are left out of the
retention numbers (they still count everywhere else).

Skips: Spotify's own "skipped" field is always false before late 2022, so a play
also counts as skipped when it ended with next, back, or "endplay" (you picked
something else). Those plays stop early in every year of the data, so this keeps
skip rates comparable across years.
"""
import argparse
import glob
import json
import os
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


def load_plays(folder):
    # Newer exports name the files Streaming_History_Audio_*.json; older ones used endsong_*.json.
    files = sorted(glob.glob(os.path.join(folder, "Streaming_History_Audio_*.json"))
                   + glob.glob(os.path.join(folder, "endsong_*.json")))
    if not files:
        raise SystemExit(f"No Streaming_History_Audio_*.json or endsong_*.json files found in {folder}")
    for path in files:
        print("Reading", os.path.basename(path))
        with open(path, encoding="utf-8") as f:
            yield from json.load(f)


SKIP_ENDS = {"fwdbtn", "backbtn", "endplay", "clickrow"}

# How a play started, grouped: picked it / played next on its own / skipped to it / pressed play or resumed / other.
# web/import.js has the same rules; keep them in step.
START_GROUPS = {"clickrow": 0, "trackdone": 1, "fwdbtn": 2, "backbtn": 2,
                "playbtn": 3, "appload": 3, "remote": 3, "reconnect": 3}


def device(platform):
    """Spotify's platform string (e.g. 'Android OS 10 API 29 (OnePlus…)', 'ios') -> a device type."""
    p = (platform or "").lower()
    if any(k in p for k in ("_tv", " tv", "tv;", "playstation", "xbox", "roku", "tizen", "webos", "chromecast")):
        return "TV / console"
    if p.startswith("partner") or any(k in p for k in ("echo", "sonos", "speaker", "google_home", "cast")):
        return "Smart speaker"
    if p.startswith("ios") or "iphone" in p or "ipad" in p:
        return "iPhone / iPad"
    if p.startswith("android"):
        return "Android"
    if p.startswith("windows"):
        return "Windows"
    if p.startswith("osx") or "os x" in p or "macos" in p:
        return "Mac"
    if "linux" in p:
        return "Linux"
    if p.startswith("web") or "web_player" in p:
        return "Web player"
    return "Other"


SLOT_MIN = 15                 # minutes per slot in the day-by-time-of-day chart
SLOTS = 24 * 60 // SLOT_MIN   # 96 slots per day
SLOT_CHARS = "0123456789abcdef"  # minutes listened in a slot (0-15), one character each


def main():
    p = argparse.ArgumentParser()
    p.add_argument("history_dir")
    p.add_argument("--tz", default="America/Chicago", help="your time zone, for months, days and time of day")
    p.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "web", "data.js"))
    p.add_argument("--name", default="", help="whose history this is, shown on the page (e.g. Evan)")
    args = p.parse_args()
    tz = ZoneInfo(args.tz)

    plays = []                      # (song, artist, album), start (local), ms played, skipped
    song_len = {}                   # (song, artist, album) -> estimated length in ms
    uris = defaultdict(Counter)     # (song, artist, album) -> track id -> plays

    # Pass 1: read every play and learn each song's length.
    for e in load_plays(args.history_dir):
        song = e.get("master_metadata_track_name")
        if not song:  # podcasts, audiobooks, bad rows
            continue
        ms = int(e.get("ms_played") or 0)
        if ms < 1000:
            continue
        # "ts" is when the track stopped; the play started ms_played earlier.
        end = datetime.fromisoformat(e["ts"].replace("Z", "+00:00"))
        start = (end - timedelta(milliseconds=ms)).astimezone(tz)
        skey = (song,
                e.get("master_metadata_album_artist_name") or "Unknown artist",
                e.get("master_metadata_album_album_name") or "")
        skipped = bool(e.get("skipped")) or e.get("reason_end") in SKIP_ENDS
        how = (device(e.get("platform")), START_GROUPS.get(e.get("reason_start"), 4),
               e.get("shuffle"), bool(e.get("offline")), bool(e.get("incognito_mode")))
        plays.append((skey, start, ms, skipped, how))
        if e.get("reason_end") == "trackdone" and ms > song_len.get(skey, 0):
            song_len[skey] = ms
        uri = e.get("spotify_track_uri") or ""
        if uri.startswith("spotify:track:"):
            uris[skey][uri.rsplit(":", 1)[1]] += 1
    if not plays:
        raise SystemExit("No music plays found in those files.")

    # Every month from first to last (no silent gaps), and every day in those months.
    first, last = min(p[1] for p in plays), max(p[1] for p in plays)
    months, (y, m) = [], (first.year, first.month)
    while (y, m) <= (last.year, last.month):
        months.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    month_ix = {mo: i for i, mo in enumerate(months)}
    day0 = date(first.year, first.month, 1)
    ny, nm = (last.year + 1, 1) if last.month == 12 else (last.year, last.month + 1)
    n_days = (date(ny, nm, 1) - day0).days

    # Pass 2: totals per (song, month), plus per-day numbers.
    # [plays, seconds, skips, measured plays, heard sum, measured skips, heard-before-skip sum]
    # "heard" is the fraction of the song played, in thousandths (1000 = whole song).
    totals = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])
    skip_hist = defaultdict(lambda: [0] * 10)   # month -> skips by % of song heard
    play_hist = defaultdict(lambda: [0] * 10)   # month -> all plays by % of song heard
    day_sec = [0] * n_days                      # seconds listened per day
    day_heard = [0] * n_days                    # seconds heard, plays with a known length
    day_len = [0] * n_days                      # full length of those same plays, seconds
    slots = [None] * n_days                     # day -> seconds per 15-minute slot
    # month -> how you listened: seconds per device, plays per start group, [shuffle on, off] plays,
    # offline seconds, private-session plays
    how_by_month = {}
    for skey, start, ms, skipped, how in plays:
        month = start.strftime("%Y-%m")
        t = totals[(*skey, month)]
        t[0] += 1
        t[1] += ms // 1000
        t[2] += skipped
        hm = how_by_month.get(month)
        if hm is None:
            hm = how_by_month[month] = {"dev": {}, "start": [0, 0, 0, 0, 0], "shuf": [0, 0], "off": 0, "priv": 0}
        dev, sg, shuffle, offline, private = how
        hm["dev"][dev] = hm["dev"].get(dev, 0) + ms // 1000
        hm["start"][sg] += 1
        if shuffle is not None:
            hm["shuf"][0 if shuffle else 1] += 1
        if offline:
            hm["off"] += ms // 1000
        if private:
            hm["priv"] += 1
        d = (start.date() - day0).days
        day_sec[d] += ms // 1000
        length = song_len.get(skey)
        if length:
            heard = min(1000, round(ms * 1000 / length))
            t[3] += 1
            t[4] += heard
            play_hist[month][min(9, heard // 100)] += 1
            day_heard[d] += min(ms, length) // 1000
            day_len[d] += length // 1000
            if skipped:
                t[5] += 1
                t[6] += heard
                skip_hist[month][min(9, heard // 100)] += 1
        # Spread the play over the 15-minute slots it covers (may cross midnight).
        cur, end = start.replace(tzinfo=None), start.replace(tzinfo=None) + timedelta(milliseconds=ms)
        while cur < end:
            slot = (cur.hour * 60 + cur.minute) // SLOT_MIN
            slot_end = datetime.combine(cur.date(), datetime.min.time()) + timedelta(minutes=(slot + 1) * SLOT_MIN)
            seg_end = min(end, slot_end)
            di = (cur.date() - day0).days
            if 0 <= di < n_days:
                if slots[di] is None:
                    slots[di] = [0] * SLOTS
                slots[di][slot] += (seg_end - cur).total_seconds()
            cur = seg_end

    def encode(day):  # minutes per slot as one hex character, trailing zeros dropped
        if day is None:
            return ""
        chars = "".join(SLOT_CHARS[min(15, round(s / 60) or (1 if s >= 10 else 0))] for s in day)
        return chars.rstrip("0")

    # Compact output: lookup tables + one flat number array, so the file stays small.
    artists, artist_ix, songs, song_ix, rows = [], {}, [], {}, []
    for (song, artist, album, month), t in sorted(totals.items(), key=lambda kv: kv[0][3]):
        if artist not in artist_ix:
            artist_ix[artist] = len(artists)
            artists.append(artist)
        skey = (song, artist, album)
        if skey not in song_ix:
            song_ix[skey] = len(songs)
            # [title, artist index, album, length in seconds (0 = unknown), Spotify track id]
            top = uris[skey].most_common(1)
            songs.append([song, artist_ix[artist], album, song_len.get(skey, 0) // 1000, top[0][0] if top else ""])
        rows += [song_ix[skey], month_ix[month], *t]

    data = {
        "name": args.name,
        "months": months, "artists": artists, "songs": songs, "cols": 9, "rows": rows,
        "skipHist": dict(skip_hist), "playHist": dict(play_hist), "how": how_by_month,
        "days": {"start": day0.isoformat(), "slotMin": SLOT_MIN, "sec": day_sec,
                 "heard": day_heard, "len": day_len, "slots": [encode(d) for d in slots]},
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("window.SPOTIFY=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")

    hours = sum(v[1] for v in totals.values()) / 3600
    print(f"{len(songs):,} songs, {len(artists):,} artists, {hours:,.0f} hours, "
          f"{n_days:,} days -> {args.out} ({os.path.getsize(args.out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
