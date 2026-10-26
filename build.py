"""Turn your Spotify Extended Streaming History into web/data.js.

Usage:
    python3 build.py path/to/Spotify_Extended_Streaming_History [--tz America/Chicago]

Then open web/index.html in a browser. No server or npm needed.

Retention: Spotify's export doesn't include song lengths, so each song's length is
taken as its longest play that ended with the track finishing ("trackdone").
Songs you never played to the end have no known length and are left out of the
retention numbers (they still count everywhere else).
"""
import argparse
import glob
import json
import os
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo


def load_plays(folder):
    files = sorted(glob.glob(os.path.join(folder, "Streaming_History_Audio_*.json")))
    if not files:
        raise SystemExit(f"No Streaming_History_Audio_*.json files found in {folder}")
    for path in files:
        print("Reading", os.path.basename(path))
        with open(path, encoding="utf-8") as f:
            yield from json.load(f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("history_dir")
    p.add_argument("--tz", default="America/Chicago", help="your time zone, for month and hour-of-day")
    p.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "web", "data.js"))
    args = p.parse_args()
    tz = ZoneInfo(args.tz)

    # month -> weekday (Mon=0) x hour -> seconds
    heat = defaultdict(lambda: [[0] * 24 for _ in range(7)])
    plays = []      # (song, artist, album, month), ms played, skipped
    song_len = {}   # (song, artist, album) -> estimated length in ms

    # Pass 1: read every play and learn each song's length.
    for e in load_plays(args.history_dir):
        song = e.get("master_metadata_track_name")
        if not song:  # podcasts, audiobooks, bad rows
            continue
        ms = int(e.get("ms_played") or 0)
        if ms < 1000:
            continue
        when = datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).astimezone(tz)
        key = (song,
               e.get("master_metadata_album_artist_name") or "Unknown artist",
               e.get("master_metadata_album_album_name") or "",
               when.strftime("%Y-%m"))
        skipped = bool(e.get("skipped")) or e.get("reason_end") == "fwdbtn"
        plays.append((key, ms, skipped))
        if e.get("reason_end") == "trackdone" and ms > song_len.get(key[:3], 0):
            song_len[key[:3]] = ms
        heat[when.strftime("%Y-%m")][when.weekday()][when.hour] += ms // 1000

    # Pass 2: totals per (song, month).
    # [plays, seconds, skips, measured plays, heard sum, measured skips, heard-before-skip sum]
    # "heard" is the fraction of the song played, stored in thousandths (1000 = whole song).
    totals = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])
    skip_hist = defaultdict(lambda: [0] * 10)  # month -> skips bucketed by % of song heard
    for key, ms, skipped in plays:
        t = totals[key]
        t[0] += 1
        t[1] += ms // 1000
        t[2] += skipped
        length = song_len.get(key[:3])
        if length:
            heard = min(1000, round(ms * 1000 / length))
            t[3] += 1
            t[4] += heard
            if skipped:
                t[5] += 1
                t[6] += heard
                skip_hist[key[3]][min(9, heard // 100)] += 1

    # Compact output: lookup tables + one flat number array, so the file stays small.
    months = sorted({k[3] for k in totals})
    month_ix = {m: i for i, m in enumerate(months)}
    artists, artist_ix, songs, song_ix, rows = [], {}, [], {}, []
    for (song, artist, album, month), t in sorted(totals.items(), key=lambda kv: kv[0][3]):
        if artist not in artist_ix:
            artist_ix[artist] = len(artists)
            artists.append(artist)
        skey = (song, artist, album)
        if skey not in song_ix:
            song_ix[skey] = len(songs)
            songs.append([song, artist_ix[artist], album])
        rows += [song_ix[skey], month_ix[month], *t]

    data = {"months": months, "artists": artists, "songs": songs, "cols": 9, "rows": rows,
            "heat": dict(heat), "skipHist": dict(skip_hist)}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("window.SPOTIFY=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")

    hours = sum(v[1] for v in totals.values()) / 3600
    print(f"{len(songs):,} songs, {len(artists):,} artists, {hours:,.0f} hours -> {args.out}")


if __name__ == "__main__":
    main()
