import urllib.request
import urllib.error
import json
import csv
import sys
import ssl
import os
from datetime import datetime, timedelta

output_file = sys.argv[1] if len(sys.argv) > 1 else 'cleaned_water_level.csv'

THAIWATER_STATIONS = [
    (172, 'คลองสองต้นนุ่น'),
    (173, 'คลองสองต้นนุ่น (มอเตอร์เวย์)'),
    (81,  'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)')
]

def format_thai_dt(iso_str):
    date_part, time_part = iso_str.split(' ')
    y, m, d = date_part.split('-')
    year_be = int(y) + 543
    return f"{d}/{m}/{year_be} {time_part}"

existing_data = set()
file_exists = os.path.exists(output_file)
if file_exists:
    with open(output_file, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        try:
            next(reader) # skip header
        except StopIteration:
            pass
        for row in reader:
            if len(row) >= 2:
                canal_name = row[0].strip()
                dt = row[1].strip()
                existing_data.add((canal_name, dt))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json'
}

new_data = []

today = datetime.now()
past = today - timedelta(days=2)
start_date = past.strftime('%Y-%m-%d')
end_date = today.strftime('%Y-%m-%d')

# 1. Fetch graph data for past 2 days
for station_id, canal_name in THAIWATER_STATIONS:
    url = f"https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_graph?station_type=canal&station_id={station_id}&start_date={start_date}&end_date={end_date}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
            res_json = json.loads(response.read().decode('utf-8'))
            graph_data = (res_json.get('data') or {}).get('graph_data') or []
            for item in graph_data:
                val = item.get('value')
                dt_iso = item.get('datetime')
                if val is not None and dt_iso:
                    dt_thai = format_thai_dt(dt_iso)
                    val_str = f"{float(val):.2f}"
                    if (canal_name, dt_thai) not in existing_data:
                        new_data.append([canal_name, dt_thai, val_str])
                        existing_data.add((canal_name, dt_thai))
    except Exception as e:
        print(f"Error fetching waterlevel_graph for {canal_name}: {e}", file=sys.stderr)

# 2. Fetch latest canal_waterlevel
try:
    url = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/canal_waterlevel"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
        res_json = json.loads(response.read().decode('utf-8'))
        for item in res_json.get('data') or []:
            sid = (item.get('station') or {}).get('id')
            matched = [name for s_id, name in THAIWATER_STATIONS if s_id == sid]
            if matched:
                canal_name = matched[0]
                dt_iso = item.get('canal_datetime')
                val = item.get('canal_value')
                if val is not None and dt_iso:
                    dt_thai = format_thai_dt(dt_iso)
                    val_str = f"{float(val):.2f}"
                    if (canal_name, dt_thai) not in existing_data:
                        new_data.append([canal_name, dt_thai, val_str])
                        existing_data.add((canal_name, dt_thai))
except Exception as e:
    print(f"Error fetching canal_waterlevel: {e}", file=sys.stderr)

if new_data:
    mode = 'a' if file_exists else 'w'
    with open(output_file, mode, newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        if not file_exists or os.path.getsize(output_file) == 0:
            writer.writerow(['คลอง', 'วัน-เวลา', 'ระดับน้ำด้านใน ม.รทก.'])
        writer.writerows(new_data)
    print(f"Successfully appended {len(new_data)} new rows to {output_file}")
else:
    print("No new rows to append. Data is up to date.")
