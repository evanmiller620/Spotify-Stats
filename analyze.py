import json
import os
from collections import defaultdict

class Time_Data:
    duration = 0
    skipCount = 0
    @classmethod
    def add_playtime(cls, duration, skipped):
        cls.duration += duration
        cls.skipCount += 1 if skipped else 0

    @classmethod
    def get_playtime(cls):
        return cls.duration
    @classmethod
    def get_skips(cls):
        return cls.skipCount

class Month(Time_Data):
    def __init__(self):
        self.days = []
        self.song_log = defaultdict(Song)
    def month_set(self, song, duration, skipped):
        self.song_log[song].add_playtime(duration, skipped)
        self.add_playtime(duration, skipped)



class Data:
    def __init__(self):
        self.playCount = 0
        self.duration = 0
        self.skipCount = 0
        self.skipped_time = 0
    def add_playtime(self, duration, skipped):
        self.duration += duration
        self.skipCount += 1 if skipped else 0
        self.playCount += 1
        self.skipped_time += duration if skipped else 0
    def add_plays(self, plays, duration, skipcount, skiptime):
        self.duration += duration
        self.skipCount += skipcount
        self.playCount += plays
        self.skipped_time += skiptime

class All_Time(Data):
    def __init__(self):
        super().__init__()
        self.song_log = defaultdict(Song)

class Song(Data):
    def __init__(self):
        super().__init__()
        self.name = ""
        self.album = ""
        self.artist = ""

def save_to_json(data: dict, filename, already_loaded):
    json_data = []
    for song in data:
        song_name, album, artist = song.split("|:|")
        duration = data[song].duration
        playCount = data[song].playCount
        skipCount = data[song].skipCount
        skippedTime = data[song].skipped_time
        skippedTime = skippedTime // skipCount if skipCount != 0 else 0
        song_log =          {"song": song_name,
                            "album": album,
                            "artist": artist,
                            "duration": duration, 
                            "playCount": playCount, 
                            "skipCount": skipCount,
                            "avgSkipTime": skippedTime}
        json_data.append(song_log)

    data = {"already_loaded": already_loaded, "data": json_data}
    with open(filename, 'w') as json_file:
        json.dump(data, json_file, indent=4)

def load_from_json(filename):
    with open(filename, 'r') as json_file:
        loaded_data =  json.load(json_file) 
        already_loaded = loaded_data['already_loaded']
        data = loaded_data['data']
        month_data = defaultdict(Month)
        for key in data:
            month_data[key] = Month()
            month_data[key].song_log = data[key]['song_log']

def process_directory(directory_path):
    filenames = list(os.listdir(directory_path))
    filenames = sorted(filenames, key = lambda x : x.split("_")[1:])
    return filenames

def process_json(file_path, month_data):
    with open(file_path, 'r') as json_file:
        skip_reasons = ['endplay', 'backbtn', 'fwdbtn','clickrow']
        delimeter = "|:|" # used to separate song, artist, and album
        data = json.load(json_file)
        for entry in data:
            date = entry['ts'].split("T")[0]
            year, month, _ = date.split("-")
            song = entry['master_metadata_track_name']
            if song == None:
                continue # podcast
                song = entry['episode_name']
            if song == None:
                continue # bad data
            artist = entry['master_metadata_album_artist_name']
            if artist == None:
                artist = entry['episode_show_name']
            album = entry['master_metadata_album_album_name']
            if album == None:
                album = entry['episode_show_name']
            duration = int(entry['ms_played']) // 1000
            if duration == 0:
                continue
            skipped = entry['skipped']
            reason_start = entry['reason_start']
            reason_end = entry['reason_end']
            if skipped == None:
                skipped = (reason_end in skip_reasons)
            month_index = year+"-"+month
            song_index = song + delimeter + album + delimeter + artist
            month_data[month_index].month_set(song_index, duration, skipped)

def process_months(month_data, year_data, all_time_data):
    total_playtime = 0
    total_plays = 0
    total_skips = 0

    for month in month_data:
        for song in month_data[month].song_log:
            song_name, album_name, artist_name = song.split("|:|")
            duration = month_data[month].song_log[song].duration
            playCount = month_data[month].song_log[song].playCount
            skipCount = month_data[month].song_log[song].skipCount
            skipTime = month_data[month].song_log[song].skipped_time
            total_playtime += duration
            total_plays += playCount
            total_skips += skipCount
            all_time_data.song_log[song].add_plays(playCount, duration, skipCount, skipTime)
    
    all_time_data.duration = total_playtime
    all_time_data.playCount = total_plays
    all_time_data.skipCount = total_skips
    print("Total duration: ", total_playtime)
    print("Total playCount: ", total_plays)
    print("Total skipCount: ", total_skips)
    print("total hours: " + str(total_playtime/3600))
            
        
if __name__ == "__main__":
    month_data = defaultdict(Month) # all data is save in month blocks
    # directory_path = "../oodrey_spoot"
    directory_path = "../evan_data_2025"
    # directory_path = "../History"
    file_names = process_directory(directory_path)
    
    # process_json(os.path.join(directory_path, file_names[0]), month_data)
    # process_json(os.path.join(directory_path, file_names[1]), month_data)
    # process_json(os.path.join(directory_path, file_names[2]), month_data)
    for file in file_names:
        print("Processing file: ", file)
        process_json(os.path.join(directory_path, file), month_data)

    year_data = {}
    all_time_data = All_Time()
    process_months(month_data, year_data, all_time_data)
    # print(all_time_data.song_log)

    save_to_json(all_time_data.song_log, "public/spotify_stats.json", file_names[0])

