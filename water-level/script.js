const BANK_LEVELS = {
  'คลองสองต้นนุ่น': 1.00,
  'คลองสองต้นนุ่น (มอเตอร์เวย์)': 2.00,
  'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)': 1.98
};
const CRITICAL_LEVEL = 0.80;
const WARNING_LEVEL = 0.50;

let allStationsData = {};
let currentStation = 'คลองสองต้นนุ่น';
let chartInstance = null;

let speedUpper = 1;
let speedLower = 1;
let speedGate = 1;
let offsetUpper = 0;
let offsetLower = 0;
let offsetGate = 0;

document.addEventListener('DOMContentLoaded', () => {
    // animate flow paths natively
    setInterval(() => {
        offsetUpper -= speedUpper;
        offsetLower -= speedLower;
        offsetGate -= speedGate;
        
        document.querySelectorAll('#path-130-131-a, #stepper-path-upper').forEach(p => {
            p.style.strokeDashoffset = offsetUpper + 'px';
        });
        
        document.querySelectorAll('#path-131-junction, #stepper-path-lower').forEach(p => {
            p.style.strokeDashoffset = offsetLower + 'px';
        });
        
        document.querySelectorAll('#path-39-junction, #path-out-west, #path-out-south').forEach(p => {
            p.style.strokeDashoffset = offsetGate + 'px';
        });
    }, 50);
});

function loadCSVData() {
  Papa.parse('cleaned_water_level.csv?t=' + new Date().getTime(), {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      const data = results.data;
      if (!data || data.length === 0) return;
      
      allStationsData = {};
      data.forEach(row => {
          const station = row['คลอง'];
          if (!allStationsData[station]) allStationsData[station] = [];
          allStationsData[station].push(row);
      });

      // Render station and analysis
      selectStation(currentStation);
      analyzeDrainage();
    },
    error: function(err) {
      console.error('Error loading CSV data:', err);
    }
  });
}

// Initial load
loadCSVData();

// Auto refresh CSV data every 5 minutes
setInterval(loadCSVData, 5 * 60 * 1000);

function selectStation(stationName) {
    currentStation = stationName;
    
    // Update Map UI highlighting
    const nodes = {
        'คลองสองต้นนุ่น (มอเตอร์เวย์)': 'node-131',
        'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)': 'node-39',
        'คลองสองต้นนุ่น': 'node-130'
    };
    
    Object.keys(nodes).forEach(key => {
        const btns = document.querySelectorAll('.' + nodes[key]);
        btns.forEach(btn => {
            const circle = btn.querySelector('.node-circle');
            const ringColor = circle.dataset.ringColor || 'ring-blue-500';
            
            if (key === stationName) {
                circle.classList.add('ring-4', 'ring-offset-2', ringColor, 'scale-110');
            } else {
                circle.classList.remove('ring-4', 'ring-offset-2', 'ring-red-500', 'ring-orange-500', 'ring-blue-500', 'scale-110');
            }
        });
    });
    
    renderStation(stationName);
}

let currentTrendPeriod = 1;

function setTrendPeriod(hours) {
    currentTrendPeriod = hours;
    
    // update UI buttons
    const periods = [1, 3, 6, 12, 24];
    periods.forEach(p => {
        const btn = document.getElementById(`btnTrend-${p}`);
        if (!btn) return;
        if (p === hours) {
            btn.className = "trend-btn flex-1 py-1.5 text-[0.65rem] sm:text-xs font-bold rounded-lg bg-white shadow-sm text-blue-600 transition-all";
        } else {
            btn.className = "trend-btn flex-1 py-1.5 text-[0.65rem] sm:text-xs font-medium rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition-all";
        }
    });
    
    updateTrendDisplay();
}

function updateTrendDisplay() {
    const data = allStationsData[currentStation] || [];
    const validData = data.filter(r => !isNaN(parseFloat(r['ระดับน้ำด้านใน ม.รทก.'])));
    
    const valueText = document.getElementById('trendValueText');
    const descText = document.getElementById('trendDescText');
    if(!valueText || !descText) return;
    
    if (validData.length === 0) {
        valueText.innerText = "--";
        descText.innerText = "ไม่มีข้อมูล";
        return;
    }
    
    const latestRow = validData[validData.length - 1];
    const latestVal = parseFloat(latestRow['ระดับน้ำด้านใน ม.รทก.']);
    const latestTimeStr = latestRow['วัน-เวลา'];
    
    // Parse latest time
    const parts = latestTimeStr.split(' ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1].split(':');
    
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const year = parseInt(dateParts[2], 10) - 543;
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    
    const latestDate = new Date(year, month, day, hour, minute);
    const targetDate = new Date(latestDate.getTime() - (currentTrendPeriod * 60 * 60 * 1000));
    
    let bestMatchRow = null;
    let minDiff = Infinity;
    
    for (let i = validData.length - 1; i >= 0; i--) {
        const row = validData[i];
        const p = row['วัน-เวลา'].split(' ');
        const dp = p[0].split('/');
        const tp = p[1].split(':');
        const rowDate = new Date(
            parseInt(dp[2], 10) - 543,
            parseInt(dp[1], 10) - 1,
            parseInt(dp[0], 10),
            parseInt(tp[0], 10),
            parseInt(tp[1], 10)
        );
        
        const diff = Math.abs(rowDate - targetDate);
        if (diff < minDiff) {
            minDiff = diff;
            bestMatchRow = row;
        } else {
            if (diff > minDiff) break;
        }
    }
    
    if (!bestMatchRow || minDiff > 3 * 60 * 60 * 1000) { // allow up to 3 hours tolerance for old data
        valueText.innerText = "--";
        descText.innerText = "ไม่มีข้อมูลประวัติในช่วงเวลานี้";
        return;
    }
    
    const oldVal = parseFloat(bestMatchRow['ระดับน้ำด้านใน ม.รทก.']);
    const diff = latestVal - oldVal;
    const periodText = currentTrendPeriod === 24 ? "1 วัน" : `${currentTrendPeriod} ชม.`;
    
    if (diff > 0.01) {
        valueText.innerText = `+${diff.toFixed(2)} ม.`;
        valueText.className = "text-2xl font-bold text-red-500";
        descText.innerText = `น้ำเพิ่มขึ้น เทียบกับ ${periodText} ที่แล้ว`;
    } else if (diff < -0.01) {
        valueText.innerText = `${diff.toFixed(2)} ม.`;
        valueText.className = "text-2xl font-bold text-blue-500";
        descText.innerText = `น้ำลดลง เทียบกับ ${periodText} ที่แล้ว`;
    } else {
        valueText.innerText = `0.00 ม.`;
        valueText.className = "text-2xl font-bold text-slate-500";
        descText.innerText = `ระดับน้ำคงที่ เทียบกับ ${periodText} ที่แล้ว`;
    }
}

function renderStation(stationName) {
    const data = allStationsData[stationName] || [];
    const chartData = [];
    const chartLabels = [];
    
    let latestVal = 0;
    let latestDate = '--:--';
    
    data.forEach(row => {
      const dt = row['วัน-เวลา'];
      let val = parseFloat(row['ระดับน้ำด้านใน ม.รทก.']);
      if(!dt || isNaN(val)) return;
      latestVal = val;
      latestDate = dt;
    });

    let lastHour = -1;
    const reversed = [...data].reverse();
    const recentPoints = [];
    
    for (let row of reversed) {
       const dt = row['วัน-เวลา'];
       let val = parseFloat(row['ระดับน้ำด้านใน ม.รทก.']);
       if(!dt || isNaN(val)) continue;
       
       const timePart = dt.split(' ')[1];
       const hour = timePart ? timePart.split(':')[0] : '';
       const datePart = dt.split(' ')[0].substring(0, 5);
       
       const key = datePart + ' ' + hour;
       if (key !== lastHour) {
           recentPoints.unshift({label: dt.substring(0, 11), val: val});
           lastHour = key;
       }
       if (recentPoints.length >= 72) break;
    }

    recentPoints.forEach(pt => {
        chartLabels.push(pt.label);
        chartData.push(pt.val);
    });

    updateUI(latestVal, latestDate);
    renderChart(chartLabels, chartData);
    
    // Check trend for banner
    updateWarningBanner(stationName);
    
    // Update Stepper
    updateTrendDisplay();
}

function updateWarningBanner(stationName) {
    const banner = document.getElementById('topWarningBanner');
    if (!banner) return;
    
    const trend = getTrend(stationName);
    if (trend.status === 'up') {
        banner.innerHTML = `<div class="bg-red-500 text-white p-3 rounded-xl shadow-sm text-sm font-bold flex items-center justify-center gap-2 mb-4 animate-pulse">
            <span class="text-xl">⚠️</span> แจ้งเตือน: ระดับน้ำที่สถานีนี้กำลังเพิ่มขึ้น ${trend.text.replace('เพิ่มขึ้น ', '')}
        </div>`;
        banner.classList.remove('hidden');
    } else if (trend.diff <= -0.01) {
        const colorClass = trend.diff <= -0.05 ? 'bg-green-500' : (trend.diff <= -0.03 ? 'bg-blue-500' : 'bg-yellow-500 text-slate-800');
        banner.innerHTML = `<div class="${colorClass} p-3 rounded-xl shadow-sm text-sm font-bold flex items-center justify-center gap-2 mb-4">
            <span class="text-xl">🌊</span> สถานการณ์ดี: ระดับน้ำที่สถานีนี้${trend.text}
        </div>`;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
        banner.innerHTML = '';
    }
}

function getTrend(stationName) {
    const data = allStationsData[stationName] || [];
    const validData = data.filter(r => !isNaN(parseFloat(r['ระดับน้ำด้านใน ม.รทก.'])));
    if(validData.length < 4) return { status: 'unknown', text: 'ข้อมูลไม่เพียงพอ', diff: 0, html: '<span class="text-slate-500 font-bold">ข้อมูลไม่เพียงพอ</span>' };
    
    // Compare latest vs 30 mins ago (4 records ago)
    const latest = parseFloat(validData[validData.length - 1]['ระดับน้ำด้านใน ม.รทก.']);
    const old = parseFloat(validData[validData.length - 4]['ระดับน้ำด้านใน ม.รทก.']); 
    
    const diff = latest - old;
    if (diff <= -0.05) return { status: 'down_fast', text: `ลดลงอย่างรวดเร็ว (${diff.toFixed(2)} ม.)`, diff: diff, html: `<span class="text-green-500 font-bold">ลดลงอย่างรวดเร็ว (${diff.toFixed(2)} ม.)</span>` };
    if (diff <= -0.03) return { status: 'down_normal', text: `ลดลงปานกลาง (${diff.toFixed(2)} ม.)`, diff: diff, html: `<span class="text-blue-500 font-bold">ลดลงปานกลาง (${diff.toFixed(2)} ม.)</span>` };
    if (diff <= -0.01) return { status: 'down_slow', text: `ลดลงเล็กน้อย (${diff.toFixed(2)} ม.)`, diff: diff, html: `<span class="text-yellow-600 font-bold">ลดลงเล็กน้อย (${diff.toFixed(2)} ม.)</span>` }; // use yellow-600 for better contrast on white background
    if (diff >= 0.01) return { status: 'up', text: `เพิ่มขึ้น (+${diff.toFixed(2)} ม.)`, diff: diff, html: `<span class="text-red-500 font-bold">เพิ่มขึ้น (+${diff.toFixed(2)} ม.)</span>` };
    return { status: 'stable', text: 'ทรงตัว', diff: diff, html: `<span class="text-red-500 font-bold">ทรงตัว</span>` };
}

function getStatusForLevel(val) {
    if (val >= CRITICAL_LEVEL) return { bg: 'bg-red-500', text: 'text-white', ring: 'ring-red-500' };
    if (val >= WARNING_LEVEL) return { bg: 'bg-orange-500', text: 'text-white', ring: 'ring-orange-500' };
    return { bg: 'bg-blue-500', text: 'text-white', ring: 'ring-blue-500' };
}

function updateNodeColor(stationKey, nodeClass) {
    const data = allStationsData[stationKey] || [];
    const validData = data.filter(r => !isNaN(parseFloat(r['ระดับน้ำด้านใน ม.รทก.'])));
    let val = 0;
    if (validData.length > 0) val = parseFloat(validData[validData.length - 1]['ระดับน้ำด้านใน ม.รทก.']);
    
    const colors = getStatusForLevel(val);
    const btns = document.querySelectorAll('.' + nodeClass);
    btns.forEach(btn => {
        const circle = btn.querySelector('.node-circle');
        const span = circle.querySelector('span');
        
        // Reset old backgrounds and text
        circle.classList.remove('bg-slate-300', 'bg-red-500', 'bg-orange-500', 'bg-blue-500');
        span.classList.remove('text-slate-500', 'text-red-600', 'text-orange-600', 'text-blue-600', 'text-white');
        
        circle.classList.add(colors.bg);
        span.classList.add(colors.text);
        
        // Store ring color for selectStation
        circle.dataset.ringColor = colors.ring;
        
        // If it is currently selected, re-apply the correct ring
        if (circle.classList.contains('ring-4')) {
            circle.classList.remove('ring-red-500', 'ring-orange-500', 'ring-blue-500');
            circle.classList.add(colors.ring);
        }
        
        // Show water level in circle
        if (validData.length > 0) {
            span.innerText = val.toFixed(2);
        } else {
            span.innerText = '-';
        }
    });
}

function getFlowProperties(diff) {
    // diff < 0 means water is dropping
    if (diff <= -0.05) return { stroke: 'stroke-green-500', text: 'text-green-500', speed: 3 }; // สีเขียว
    if (diff <= -0.03) return { stroke: 'stroke-blue-400', text: 'text-blue-400', speed: 1.5 }; // สีฟ้า
    if (diff <= -0.01) return { stroke: 'stroke-yellow-500', text: 'text-yellow-500', speed: 0.8 }; // สีเหลือง
    return { stroke: 'stroke-red-500', text: 'text-red-500', speed: 0.2 }; // ทรงตัว/เพิ่มขึ้น (สีแดง)
}

function analyzeDrainage() {
    const box = document.getElementById('drainageAnalysisBox');
    if (!box) return;
    
    const s130 = getTrend('คลองสองต้นนุ่น'); // ต้นน้ำ
    const s131 = getTrend('คลองสองต้นนุ่น (มอเตอร์เวย์)'); // กลางน้ำ
    const s39 = getTrend('คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)'); // ปลายน้ำ
    
    // Update node colors based on indicator (absolute level)
    updateNodeColor('คลองสองต้นนุ่น', 'node-130');
    updateNodeColor('คลองสองต้นนุ่น (มอเตอร์เวย์)', 'node-131');
    updateNodeColor('คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)', 'node-39');
    
    let html = `<ul class="space-y-2 mb-3">
        <li><span class="font-bold text-slate-700">📌 ต้นน้ำ (130 ซ.ร่มเกล้า 20):</span> ${s130.html}</li>
        <li><span class="font-bold text-slate-700">📌 กลางน้ำ (131 มอเตอร์เวย์):</span> ${s131.html}</li>
        <li><span class="font-bold text-slate-700">📌 ปลายน้ำ (39 ปตร.ลาดกระบัง):</span> ${s39.html}</li>
    </ul>`;
    
    // Determine flow speeds and colors for Upper (130->131), Lower (131->Jct), and Gate (39->Jct/Out)
    const upperProps = getFlowProperties(s130.diff || 0);
    const lowerProps = getFlowProperties(s131.diff || 0);
    const gateProps = getFlowProperties(s39.diff || 0);
    
    speedUpper = upperProps.speed;
    speedLower = lowerProps.speed;
    speedGate = gateProps.speed;
    
    const pathsUpper = [
        document.getElementById('path-130-131-a'),
        document.getElementById('stepper-path-upper')
    ];
    const pathsLower = [
        document.getElementById('path-131-junction'),
        document.getElementById('stepper-path-lower')
    ];
    const pathsGate = [
        document.getElementById('path-39-junction'),
        document.getElementById('path-out-west'),
        document.getElementById('path-out-south'),
        document.getElementById('path-junction-joint')
    ];
    
    // Apply classes
    pathsUpper.forEach(el => {
        if (!el) return;
        el.className.baseVal = el.tagName === 'circle' ? `${upperProps.text} transition-colors duration-500` : `flow-line ${upperProps.stroke} transition-colors duration-500`;
    });
    
    pathsLower.forEach(el => {
        if (!el) return;
        el.className.baseVal = el.tagName === 'circle' ? `${lowerProps.text} transition-colors duration-500` : `flow-line ${lowerProps.stroke} transition-colors duration-500`;
    });
    
    pathsGate.forEach(el => {
        if (!el) return;
        el.className.baseVal = el.tagName === 'circle' ? `${gateProps.text} transition-colors duration-500` : `flow-line ${gateProps.stroke} transition-colors duration-500`;
    });
    
    // Generate overall summary
    if (s130.diff <= -0.01) {
        if (s131.diff > -0.01 && s39.diff > -0.01) {
            html += `<div class="p-3 bg-red-100 text-red-800 rounded border border-red-200">
                <strong>⚠️ ตรวจพบความผิดปกติ:</strong> สถานีต้นน้ำ (130) ระดับน้ำกำลังลดลง แต่สถานีถัดไป (131 และ 39) ยังไม่ลดตาม อาจมีสิ่งกีดขวางทางน้ำ หรือการระบายน้ำล่าช้า
            </div>`;
        } else {
            html += `<div class="p-3 bg-green-100 text-green-800 rounded border border-green-200">
                <strong>✅ การระบายน้ำปกติ:</strong> น้ำถูกพร่องลงอย่างต่อเนื่องไปสู่ปลายน้ำ
            </div>`;
        }
    } else if (s130.diff >= 0.01) {
         html += `<div class="p-3 bg-orange-100 text-orange-800 rounded border border-orange-200">
                <strong>⏳ แจ้งเตือน:</strong> สถานีต้นน้ำ (130) มีระดับน้ำเพิ่มขึ้น โปรดเฝ้าระวังมวลน้ำที่จะไหลผ่าน 131 ไปยัง 39 ในอีก 1-2 ชั่วโมง
            </div>`;
    } else {
         html += `<div class="p-3 bg-slate-200 text-slate-800 rounded border border-slate-300">
                <strong>ℹ️ สถานการณ์:</strong> ระดับน้ำทรงตัว ไม่มีสัญญาณการเร่งระบายน้ำที่ชัดเจน
            </div>`;
    }
    
    box.innerHTML = html;
}

function parseThaiDateTime(str) {
    if (!str) return new Date();
    try {
        const parts = str.split(' ');
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10) - 543;
        const hour = parseInt(timeParts[0], 10);
        const minute = parseInt(timeParts[1], 10);
        return new Date(year, month, day, hour, minute);
    } catch (e) {
        return new Date();
    }
}

function updateEstimateUI(stationName, currentLevel) {
    const rateEl = document.getElementById('estimateRateText');
    const timeEl = document.getElementById('estimateTimeText');
    if (!rateEl || !timeEl) return;

    const data = allStationsData[stationName] || [];
    const validData = data.filter(r => !isNaN(parseFloat(r['ระดับน้ำด้านใน ม.รทก.'])));

    if (validData.length < 5) {
        rateEl.innerText = '--';
        timeEl.innerText = 'ข้อมูลไม่เพียงพอสำหรับประเมิน';
        return;
    }

    const latestRow = validData[validData.length - 1];
    const latestDate = parseThaiDateTime(latestRow['วัน-เวลา']);
    const latestVal = currentLevel;

    // Lookback window: up to 24 hours
    const targetDate = new Date(latestDate.getTime() - (24 * 3600 * 1000));
    let closestRow = null;
    let minDiff = Infinity;

    for (let i = 0; i < validData.length - 1; i++) {
        const rDate = parseThaiDateTime(validData[i]['วัน-เวลา']);
        const diff = Math.abs(rDate - targetDate);
        if (diff < minDiff) {
            minDiff = diff;
            closestRow = validData[i];
        }
    }

    if (!closestRow) {
        rateEl.innerText = '--';
        timeEl.innerText = '';
        return;
    }

    const oldVal = parseFloat(closestRow['ระดับน้ำด้านใน ม.รทก.']);
    const oldDate = parseThaiDateTime(closestRow['วัน-เวลา']);
    const actualHours = Math.max(1, (latestDate - oldDate) / (1000 * 3600));

    const dropTotal = oldVal - latestVal; // positive = water level dropped
    const dropRatePerHour = dropTotal / actualHours;

    if (dropRatePerHour >= 0.0005) {
        const rateFormatted = dropRatePerHour >= 0.01 
            ? dropRatePerHour.toFixed(2) 
            : dropRatePerHour.toFixed(3);

        // Color coding for drop rate:
        // 0.02 ขึ้นไป -> สีเขียว (#16a34a)
        // 0.01 ต่อ ชม -> สีฟ้า (#0284c7)
        // เกิน 0.005 ต่อชั่วโมง (และระดับช้า เช่น 0.002) -> สีเหลือง (#ca8a04)
        let rateColor = '#ca8a04';
        if (dropRatePerHour >= 0.02) {
            rateColor = '#16a34a';
        } else if (dropRatePerHour >= 0.01) {
            rateColor = '#0284c7';
        } else {
            rateColor = '#ca8a04';
        }

        rateEl.innerHTML = `น้ำลดเฉลี่ยชั่วโมงละ <span style="color: ${rateColor};" class="font-bold">${rateFormatted} ม.</span>`;
        rateEl.className = "text-xl sm:text-2xl font-bold text-slate-800 mt-1";
    } else if (dropRatePerHour <= -0.0005) {
        const riseRate = Math.abs(dropRatePerHour);
        const rateFormatted = riseRate >= 0.01 ? riseRate.toFixed(2) : riseRate.toFixed(3);
        rateEl.innerHTML = `น้ำเพิ่มเฉลี่ยชั่วโมงละ <span style="color: #dc2626;" class="font-bold">${rateFormatted} ม.</span>`;
        rateEl.className = "text-xl sm:text-2xl font-bold text-slate-800 mt-1";
    } else {
        rateEl.innerText = `ระดับน้ำทรงตัว`;
        rateEl.className = "text-xl sm:text-2xl font-bold text-slate-800 mt-1";
    }

    // 2. ค้นหาการเปลี่ยนแปลงล่าสุดเพียงอันเดียว (ลด หรือ เพิ่ม)
    let latestChange = null;
    for (let i = validData.length - 1; i >= 1; i--) {
        const cur = parseFloat(validData[i]['ระดับน้ำด้านใน ม.รทก.']);
        const prev = parseFloat(validData[i - 1]['ระดับน้ำด้านใน ม.รทก.']);
        if (cur < prev) {
            latestChange = { isDrop: true, row: validData[i] };
            break;
        } else if (cur > prev) {
            latestChange = { isDrop: false, row: validData[i] };
            break;
        }
    }

    if (latestChange) {
        const eventDate = parseThaiDateTime(latestChange.row['วัน-เวลา']);
        const now = new Date();
        const diffMins = Math.max(0, Math.floor((now - eventDate) / 60000));
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        const parts = latestChange.row['วัน-เวลา'].split(' ');
        const datePart = parts[0] || '';
        const timePart = parts[1] || '';

        let relStr = '';
        if (diffDays >= 1) {
            relStr = `${diffDays} วันที่แล้ว`;
        } else if (diffHours >= 1) {
            relStr = `${diffHours} ชั่วโมงที่แล้ว`;
        } else if (diffMins > 0) {
            relStr = `${diffMins} นาทีที่แล้ว`;
        } else {
            relStr = `สักครู่ที่ผ่านมา`;
        }

        let timeColor = '';
        if (!latestChange.isDrop) {
            // น้ำเพิ่ม -> สีแดงเสมอ
            timeColor = '#dc2626';
        } else {
            // น้ำลด -> ตามเกณฑ์เวลา
            if (diffDays >= 1) {
                timeColor = '#dc2626'; // สีแดง (> 1 วัน)
            } else if (diffHours >= 12) {
                timeColor = '#ca8a04'; // สีเหลือง (> 12 ชม.)
            } else if (diffHours >= 3) {
                timeColor = '#0284c7'; // สีฟ้า (> 3 ชม.)
            } else {
                timeColor = '#16a34a'; // สีเขียว (ไม่เกิน 3 ชม.)
            }
        }

        const timeDetail = diffDays >= 1 ? `${datePart} ${timePart}` : `${timePart} น.`;
        const label = latestChange.isDrop ? 'น้ำลดล่าสุดเมื่อ' : 'น้ำเพิ่มล่าสุดเมื่อ';
        timeEl.innerHTML = `${label} <span style="color: ${timeColor};" class="font-bold">${relStr}</span> <span class="text-slate-400 font-normal">(${timeDetail})</span>`;
        timeEl.className = "text-xs sm:text-sm font-medium mt-1 text-slate-500 text-right";
        timeEl.style.color = '';
    } else {
        timeEl.innerHTML = `ระดับน้ำทรงตัวต่อเนื่องในประวัติ`;
        timeEl.className = "text-xs sm:text-sm font-medium mt-1 text-slate-400 text-right";
        timeEl.style.color = '';
    }
}

function updateUI(level, datetime) {
  const latestTimeEl = document.getElementById('latestTime');
  if (latestTimeEl) latestTimeEl.innerText = datetime;
  
  const currentLevelEl = document.getElementById('currentLevelText');
  if (currentLevelEl) currentLevelEl.innerText = level.toFixed(2);
  
  // Calculate Time Ago
  const badge = document.getElementById('timeAgoBadge');
  if (badge) {
      try {
          const parts = datetime.split(' ');
          const dateParts = parts[0].split('/');
          const timeParts = parts[1].split(':');
          
          const day = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1;
          const year = parseInt(dateParts[2], 10) - 543;
          const hour = parseInt(timeParts[0], 10);
          const minute = parseInt(timeParts[1], 10);
          
          const recordTime = new Date(year, month, day, hour, minute);
          const now = new Date();
          const diffMins = Math.max(0, Math.floor((now - recordTime) / 60000));
          
          badge.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'bg-yellow-100', 'text-yellow-700', 'bg-slate-100', 'text-slate-600');
          
          if (diffMins < 60) {
              badge.innerText = `${diffMins} นาทีที่แล้ว`;
              badge.classList.add('bg-green-100', 'text-green-700');
          } else {
              const diffHours = Math.floor(diffMins / 60);
              if (diffHours < 3) {
                  badge.innerText = `${diffHours} ชั่วโมงที่แล้ว`;
                  badge.classList.add('bg-yellow-100', 'text-yellow-700');
              } else {
                  const diffDays = Math.floor(diffHours / 24);
                  if (diffDays === 0) {
                      badge.innerText = `${diffHours} ชั่วโมงที่แล้ว`;
                  } else {
                      badge.innerText = `${diffDays} วันที่แล้ว`;
                  }
                  badge.classList.add('bg-slate-100', 'text-slate-600');
              }
          }
      } catch (e) {
          badge.classList.add('hidden');
      }
  }

  // Calculate Bank difference
  const bankValue = BANK_LEVELS[currentStation] || 1.00;
  const diffBank = bankValue - level;
  const bankTextEl = document.getElementById('bankStatusText');
  if (bankTextEl) {
      if (diffBank > 0) {
        bankTextEl.innerText = `ต่ำกว่าตลิ่ง ${diffBank.toFixed(2)} ม.`;
        bankTextEl.className = "text-2xl font-bold text-slate-800 mt-1";
      } else {
        bankTextEl.innerText = `ล้นตลิ่ง ${Math.abs(diffBank).toFixed(2)} ม.`;
        bankTextEl.className = "text-2xl font-bold text-red-600 mt-1";
      }
  }

  const bankDetailEl = document.getElementById('bankDetailText');
  if (bankDetailEl) {
      bankDetailEl.innerHTML = `<span style="color: #92400e;" class="font-semibold">ตลิ่งสูง ${bankValue.toFixed(2)} ม.</span>`;
  }

  // Update Drainage Estimate on the right
  updateEstimateUI(currentStation, level);

  // Tank Fill Height (max 1.00m to align perfectly with CSS gradient percentages)
  const maxDisplay = 1.00;
  let percent = (level / maxDisplay) * 100;
  if (percent > 100) percent = 100;
  if (percent < 0) percent = 0;
  
  const wave1 = document.getElementById('wave1');
  const wave2 = document.getElementById('wave2');
  if (wave1) wave1.style.bottom = `${percent}%`;
  if (wave2) wave2.style.bottom = `${percent}%`;

  // Status Colors & Car logic
  let badgeHtml = 'ปกติ';
  let badgeClasses = 'bg-blue-100 text-blue-700';
  let levelTextBorder = 'border-blue-200 shadow-blue-500/20';

  let sedanStatus = { text: 'ผ่านได้สบาย', color: 'bg-green-100 text-green-700', border: 'border-green-200 bg-green-50' };
  let suvStatus = { text: 'ผ่านได้สบาย', color: 'bg-green-100 text-green-700', border: 'border-green-200 bg-green-50' };
  let pickupStatus = { text: 'ผ่านได้สบาย', color: 'bg-green-100 text-green-700', border: 'border-green-200 bg-green-50' };

  if (level >= CRITICAL_LEVEL) {
    badgeHtml = '🚨 วิกฤต';
    badgeClasses = 'bg-red-100 text-red-700';
    levelTextBorder = 'border-red-400 shadow-red-500/40';
    
    sedanStatus = { text: '❌ ห้ามผ่านเด็ดขาด', color: 'bg-red-100 text-red-700', border: 'border-red-200 bg-red-50' };
    suvStatus = { text: '⚠️ ควรหลีกเลี่ยง', color: 'bg-orange-100 text-orange-700', border: 'border-orange-200 bg-orange-50' };
    pickupStatus = { text: '✅ ผ่านได้ (ช้าๆ)', color: 'bg-green-100 text-green-700', border: 'border-green-200 bg-green-50' };
    
  } else if (level >= WARNING_LEVEL) {
    badgeHtml = '⚠️ เฝ้าระวัง';
    badgeClasses = 'bg-orange-100 text-orange-700';
    levelTextBorder = 'border-orange-400 shadow-orange-500/40';
    
    sedanStatus = { text: '⚠️ ระวังแอ่งลึก', color: 'bg-orange-100 text-orange-700', border: 'border-orange-200 bg-orange-50' };
    suvStatus = { text: '✅ ผ่านได้', color: 'bg-green-100 text-green-700', border: 'border-green-200 bg-green-50' };
    
  }

  const levelTextBox = document.getElementById('levelTextBox');
  if (levelTextBox) {
      levelTextBox.className = `bg-white/90 backdrop-blur-sm px-4 py-2 rounded-2xl shadow-lg border-2 text-center transform translate-y-4 ${levelTextBorder}`;
  }
  
  const statusBadgeElement = document.getElementById('statusBadge');
  if (statusBadgeElement) {
      statusBadgeElement.innerHTML = badgeHtml;
      statusBadgeElement.className = `self-end px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-sm ${badgeClasses}`;
      statusBadgeElement.style.alignSelf = 'flex-end';
  }

  // Update Car Cards
  updateCarCard('Sedan', sedanStatus);
  updateCarCard('SUV', suvStatus);
  updateCarCard('Pickup', pickupStatus);
}

function updateCarCard(type, status) {
  const card = document.getElementById(`car${type}`);
  const badge = document.getElementById(`status${type}`);
  if (!card || !badge) return;
  
  card.className = `car-card p-4 rounded-xl border flex flex-col items-center text-center ${status.border}`;
  badge.innerText = status.text;
  badge.className = `mt-auto px-3 py-1 rounded-full text-[0.7rem] font-bold w-full ${status.color}`;
}

function renderChart(labels, data) {
  const ctxEl = document.getElementById('historyChart');
  if (!ctxEl) return;
  const ctx = ctxEl.getContext('2d');
  
  if (chartInstance) {
      chartInstance.destroy();
  }
  
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'ระดับน้ำ (ม.รทก.)',
        data: data,
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14, 165, 233, 0.1)',
        borderWidth: 2,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(c) {
              return c.parsed.y.toFixed(2) + ' ม.';
            }
          }
        }
      },
      scales: {
        y: {
          suggestedMin: 0,
          suggestedMax: 1.0,
          grid: { color: '#f1f5f9' },
          border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6 }
        }
      }
    }
  });
}
