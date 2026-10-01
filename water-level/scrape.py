import urllib.request
import urllib.error
import json
import re
import csv
import sys
import ssl
import os
import time
from datetime import datetime, timedelta

output_file = sys.argv[1] if len(sys.argv) > 1 else 'cleaned_water_level.csv'

BMA_STATIONS = [
    (130, 'คลองสองต้นนุ่น'),
    (131, 'คลองสองต้นนุ่น (มอเตอร์เวย์)'),
    (39,  'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)')
]

THAIWATER_MAP = {
    130: 172,
    131: 173,
    39: 81
}

def format_thai_dt_from_iso(iso_str):
    date_part, time_part = iso_str.split(' ')
    y, m, d = date_part.split('-')
    year_be = int(y) + 543
    return f"{d}/{m}/{year_be} {time_part}"

def parse_thai_dt(dt_str):
    try:
        parts = dt_str.strip().split(' ')
        d, m, y = [int(x) for x in parts[0].split('/')]
        if y > 2500:
            y -= 543
        hr, mn = [int(x) for x in parts[1].split(':')]
        return datetime(y, m, d, hr, mn)
    except Exception:
        return None

all_rows = []
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
            if len(row) >= 3:
                canal_name = row[0].strip()
                dt = row[1].strip()
                val = row[2].strip()
                all_rows.append((canal_name, dt, val))
                existing_data.add((canal_name, dt))

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
}

new_data = []

def fetch_bma_station_with_retry(station_id, canal_name, max_retries=5, delay=3):
    url = f"https://weather.bangkok.go.th/water/StationDetail?id={station_id}"
    for attempt in range(1, max_retries + 1):
        try:
            print(f"[{canal_name}] Fetching BMA URL: attempt {attempt}/{max_retries}...")
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, context=ctx, timeout=20) as response:
                html = response.read().decode('utf-8')
                tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL | re.IGNORECASE)
                if tbody_match:
                    rows = re.findall(r'<tr>(.*?)</tr>', tbody_match.group(1), re.DOTALL | re.IGNORECASE)
                    parsed_rows = []
                    for row in rows:
                        cols = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
                        if len(cols) >= 3:
                            dt = cols[1].strip()
                            val = cols[2].strip()
                            parsed_rows.append((canal_name, dt, val))
                    if parsed_rows:
                        print(f"[{canal_name}] Successfully fetched {len(parsed_rows)} rows from BMA.")
                        return parsed_rows
        except urllib.error.HTTPError as e:
            print(f"[{canal_name}] HTTP Error {e.code}: {e.reason} (attempt {attempt}/{max_retries})", file=sys.stderr)
            if e.code == 403:
                time.sleep(delay * attempt)
            else:
                time.sleep(delay)
        except Exception as e:
            print(f"[{canal_name}] Network/parse error: {e} (attempt {attempt}/{max_retries})", file=sys.stderr)
            time.sleep(delay)
    return None

def fetch_thaiwater_backup():
    print("Attempting backup fetch from ThaiWater API...")
    backup_rows = []
    try:
        url = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/canal_waterlevel"
        req = urllib.request.Request(url, headers={'User-Agent': HEADERS['User-Agent'], 'Accept': 'application/json'})
        with urllib.request.urlopen(req, context=ctx, timeout=20) as response:
            res_json = json.loads(response.read().decode('utf-8'))
            for item in res_json.get('data') or []:
                sid = (item.get('station') or {}).get('id')
                for bma_id, canal_name in BMA_STATIONS:
                    if THAIWATER_MAP.get(bma_id) == sid:
                        dt_iso = item.get('canal_datetime')
                        val = item.get('canal_value')
                        if val is not None and dt_iso:
                            dt_thai = format_thai_dt_from_iso(dt_iso)
                            val_str = f"{float(val):.2f}"
                            backup_rows.append((canal_name, dt_thai, val_str))
    except Exception as e:
        print(f"Backup fetch from ThaiWater error: {e}", file=sys.stderr)
    return backup_rows

# Run scraping
for station_id, canal_name in BMA_STATIONS:
    rows = fetch_bma_station_with_retry(station_id, canal_name, max_retries=5, delay=3)
    if rows:
        for cname, dt, val in rows:
            if (cname, dt) not in existing_data:
                new_data.append((cname, dt, val))
                existing_data.add((cname, dt))
    else:
        print(f"[{canal_name}] All BMA attempts failed (403 or error). Will use backup source.")

# If any station failed or no new data from BMA, check backup source
if len(new_data) == 0:
    backup_rows = fetch_thaiwater_backup()
    for cname, dt, val in backup_rows:
        if (cname, dt) not in existing_data:
            new_data.append((cname, dt, val))
            existing_data.add((cname, dt))

print(f"Found {len(new_data)} new data points to add.")

# Combine existing and new data
for item in new_data:
    all_rows.append(item)

# Deduplicate
unique_dict = {}
for canal_name, dt, val in all_rows:
    unique_dict[(canal_name, dt)] = val

combined_rows = []
for (canal_name, dt), val in unique_dict.items():
    p_dt = parse_thai_dt(dt)
    if p_dt:
        combined_rows.append((p_dt, canal_name, dt, val))

if combined_rows:
    max_dt = max(r[0] for r in combined_rows)
    cutoff_dt = max_dt - timedelta(days=3)
    
    # Filter to last 3 days
    recent_rows = [r for r in combined_rows if r[0] >= cutoff_dt]
    # Sort chronologically
    recent_rows.sort(key=lambda r: (r[0], r[1]))
    
    with open(output_file, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        writer.writerow(['คลอง', 'วัน-เวลา', 'ระดับน้ำด้านใน ม.รทก.'])
        for _, canal_name, dt, val in recent_rows:
            writer.writerow([canal_name, dt, val])
            
    print(f"Data saved to {output_file}. Kept {len(recent_rows)} rows (last 3 days from {cutoff_dt.strftime('%d/%m/%Y %H:%M')} to {max_dt.strftime('%d/%m/%Y %H:%M')}).")
else:
    print("No valid rows found.")
