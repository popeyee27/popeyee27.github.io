import urllib.request
import urllib.error
import re
import csv
import sys
import ssl
import os

output_file = sys.argv[1]

stations = [
    (130, 'คลองสองต้นนุ่น'),
    (131, 'คลองสองต้นนุ่น (มอเตอร์เวย์)'),
    (39, 'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)')
]

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
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}

new_data = []

for station_id, canal_name in stations:
    url = f'https://weather.bangkok.go.th/water/StationDetail?id={station_id}'
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
            html = response.read().decode('utf-8')
    except Exception as e:
        print(f'Error fetching {url}: {e}', file=sys.stderr)
        continue

    # Extract table body
    tbody_match = re.search(r'<tbody>(.*?)</tbody>', html, re.DOTALL | re.IGNORECASE)
    if not tbody_match:
        print(f'Error: Could not find <tbody> for {canal_name}', file=sys.stderr)
        continue
    tbody = tbody_match.group(1)

    rows = re.findall(r'<tr>(.*?)</tr>', tbody, re.DOTALL | re.IGNORECASE)
    for row in rows:
        cols = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL | re.IGNORECASE)
        if len(cols) >= 3:
            dt = cols[1].strip()
            val = cols[2].strip()
            if (canal_name, dt) not in existing_data:
                new_data.append([canal_name, dt, val])
                existing_data.add((canal_name, dt))

if new_data:
    # Sort new data by datetime ascending just to be neat, though they are from different stations
    mode = 'a' if file_exists else 'w'
    with open(output_file, mode, newline='', encoding='utf-8-sig') as f:
        writer = csv.writer(f)
        if not file_exists or os.path.getsize(output_file) == 0:
            writer.writerow(['คลอง', 'วัน-เวลา', 'ระดับน้ำด้านใน ม.รทก.'])
        writer.writerows(new_data)
    print(f'Successfully appended {len(new_data)} new rows to {output_file}')
else:
    print(f'No new rows to append. Data is up to date.')
