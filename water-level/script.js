const BANK_LEVEL = 1.00;
const CRITICAL_LEVEL = 0.80;
const WARNING_LEVEL = 0.50;

let allStationsData = {};
let currentStation = 'คลองสองต้นนุ่น';
let chartInstance = null;

// Fetch and parse data (with cache-busting)
Papa.parse('cleaned_water_level.csv?t=' + new Date().getTime(), {
  download: true,
  header: true,
  skipEmptyLines: true,
  complete: function(results) {
    const data = results.data;
    if(data.length === 0) return;
    
    allStationsData = {};
    data.forEach(row => {
        const station = row['คลอง'];
        if(!allStationsData[station]) allStationsData[station] = [];
        allStationsData[station].push(row);
    });

    // Initial render
    selectStation('คลองสองต้นนุ่น'); // Default
    analyzeDrainage();
  }
});

function selectStation(stationName) {
    currentStation = stationName;
    
    // Update Map UI highlighting
    const nodes = {
        'คลองสองต้นนุ่น (มอเตอร์เวย์)': 'node-131',
        'คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)': 'node-39',
        'คลองสองต้นนุ่น': 'node-130'
    };
    
    Object.keys(nodes).forEach(key => {
        const btn = document.getElementById(nodes[key]);
        if (!btn) return;
        const circle = btn.querySelector('.node-circle');
        const text = btn.querySelector('.node-text');
        
        if (key === stationName) {
            circle.classList.remove('border-slate-300');
            circle.classList.add('border-blue-600', 'scale-110');
            circle.querySelector('span').classList.replace('text-slate-500', 'text-blue-600');
            text.classList.replace('text-slate-500', 'text-blue-700');
        } else {
            circle.classList.add('border-slate-300');
            circle.classList.remove('border-blue-600', 'scale-110');
            circle.querySelector('span').classList.replace('text-blue-600', 'text-slate-500');
            text.classList.replace('text-blue-700', 'text-slate-500');
        }
    });
    
    renderStation(stationName);
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
}

function updateWarningBanner(stationName) {
    const banner = document.getElementById('topWarningBanner');
    if (!banner) return;
    
    const trend = getTrend(stationName);
    if (trend.status === 'up') {
        banner.innerHTML = `<div class="bg-red-500 text-white p-3 rounded-xl shadow-sm text-sm font-bold flex items-center justify-center gap-2 mb-4 animate-pulse">
            <span class="text-xl">⚠️</span> แจ้งเตือน: ระดับน้ำที่สถานีนี้กำลังเพิ่มขึ้น ${trend.text.replace('กำลังเพิ่มขึ้น ', '')}
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
    if(validData.length < 12) return { status: 'unknown', text: 'ข้อมูลไม่เพียงพอ' };
    
    // Compare latest vs 1-2 hours ago (about 6-12 records ago since it's every 10 mins)
    const latest = parseFloat(validData[validData.length - 1]['ระดับน้ำด้านใน ม.รทก.']);
    const old = parseFloat(validData[validData.length - 7]['ระดับน้ำด้านใน ม.รทก.']); // ~1 hour ago
    
    const diff = latest - old;
    if (diff <= -0.02) return { status: 'down', text: `กำลังลดลง (${diff.toFixed(2)} ม./ชม.)` };
    if (diff >= 0.02) return { status: 'up', text: `กำลังเพิ่มขึ้น (+${diff.toFixed(2)} ม./ชม.)` };
    return { status: 'stable', text: 'ทรงตัว' };
}

function analyzeDrainage() {
    const box = document.getElementById('drainageAnalysisBox');
    if (!box) return;
    
    const s130 = getTrend('คลองสองต้นนุ่น'); // ต้นน้ำ
    const s131 = getTrend('คลองสองต้นนุ่น (มอเตอร์เวย์)'); // กลางน้ำ
    const s39 = getTrend('คลองประเวศบุรีรมย์ (ปตร.ลาดกระบัง)'); // ปลายน้ำ
    
    let html = `<ul class="space-y-2 mb-3">
        <li><span class="font-bold text-slate-700">📌 ต้นน้ำ (130 ซ.ร่มเกล้า 20):</span> ${s130.text}</li>
        <li><span class="font-bold text-slate-700">📌 กลางน้ำ (131 มอเตอร์เวย์):</span> ${s131.text}</li>
        <li><span class="font-bold text-slate-700">📌 ปลายน้ำ (39 ปตร.ลาดกระบัง):</span> ${s39.text}</li>
    </ul>`;
    
    if (s130.status === 'down') {
        if (s131.status !== 'down' && s39.status !== 'down') {
            html += `<div class="p-3 bg-red-100 text-red-800 rounded border border-red-200">
                <strong>⚠️ ตรวจพบความผิดปกติ:</strong> สถานีต้นน้ำ (130) ระดับน้ำกำลังลดลง แต่สถานีถัดไป (131 และ 39) ยังไม่ลดตาม อาจมีสิ่งกีดขวางทางน้ำ หรือการระบายน้ำล่าช้า
            </div>`;
        } else {
            html += `<div class="p-3 bg-green-100 text-green-800 rounded border border-green-200">
                <strong>✅ การระบายน้ำปกติ:</strong> น้ำถูกพร่องลงอย่างต่อเนื่องไปสู่ปลายน้ำ
            </div>`;
        }
    } else if (s130.status === 'up') {
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
  const diffBank = BANK_LEVEL - level;
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
      statusBadgeElement.className = `px-3 py-1 rounded-full text-xs font-bold ${badgeClasses}`;
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
