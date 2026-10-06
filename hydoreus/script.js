// Query parameter support: ?loc=srinakarin. Everything else about an area (names, stations, labels)
// comes from the server's JSON (config/areas.json on the server); the page only knows where to look.
const urlParams = new URLSearchParams(window.location.search);
const AREA_FOLDERS = { romklao24: '/v1/romklao24', srinakarin: '/v1/srinakarin' };
const AREA_CODE = Object.hasOwn(AREA_FOLDERS, urlParams.get('loc') || '') ? urlParams.get('loc') : 'romklao24';

const IS_MOBILE = window.matchMedia('(max-width: 639.98px)').matches;
if (window.Chart) {
    Chart.defaults.font.family = "'Kanit', sans-serif";
    Chart.defaults.font.size = IS_MOBILE ? 13 : 11;
}

// ?data=local reads JSON from ./v1/<area> (local testing without hitting R2)
const DATA_BASE_URL = (urlParams.get('data') === 'local' ? '.' : 'https://hydoreus.bcyu.dev') + AREA_FOLDERS[AREA_CODE];

// Run periodic refreshes only while the tab is visible (saves R2 Class B reads)
function whenVisible(fn) {
    return () => { if (!document.hidden) fn(); };
}


let chartInstance = null;

const stationTrendPeriods = {};   // station id -> hours (default 1)


// ===== Server-built sections (~/hydoreus-server builder) =====
// The server computes everything; this page only renders and handles time-relative bits.
// manifest.json says when sections were built; we poll it right after each expected rebuild.
const SECTION_SCHEMA = 1;
const SECTION_BASE_URL = DATA_BASE_URL + (urlParams.get('data') === 'local' ? '/sections' : '');
const SECTION_RENDERERS = { stations: renderStationsSection, history: renderCombinedHistoryChart, warning: renderTmdAlerts, daily: renderDailyForecast, hourly: renderHourlyForecast, short_rain: renderMinutelyTimeline, current: renderCurrentSection, risk: renderRiskSection };
const MANIFEST_MAX_AGE_MS = 15 * 60 * 1000;
const sectionData = {};
const sectionChangedAt = {};
let sectionTimer = null;

function setSectionStale(name, stale) {
    const el = document.querySelector(`[data-stale-for="${name}"]`);
    if (el) el.hidden = !stale;
}

function showRefreshNotice() {
    if (document.getElementById('refreshNotice')) return;
    const n = document.createElement('div');
    n.id = 'refreshNotice';
    n.className = 'refresh-notice';
    n.innerHTML = 'มีหน้าเว็บเวอร์ชันใหม่ <button type="button" onclick="location.reload()">กรุณารีเฟรช</button>';
    document.body.prepend(n);
}

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

let sectionsInFlight = null;
function loadSections() {
    // One load at a time: a tab-return while a timed load is running reuses that load
    if (!sectionsInFlight) sectionsInFlight = doLoadSections().finally(() => { sectionsInFlight = null; });
    return sectionsInFlight;
}

async function doLoadSections() {
    clearTimeout(sectionTimer);
    let nextMs = 6 * 60 * 1000;
    try {
        const bucket = Math.floor(Date.now() / 60000);
        const manifest = await fetchJson(`${SECTION_BASE_URL}/manifest.json?t=${bucket}`);
        if (manifest.schema_version !== SECTION_SCHEMA) { showRefreshNotice(); return; }
        applyAreaHeader(manifest.area_info);
        // The server rebuilds every ~6 min; a manifest older than 15 min means the server loop has stopped:
        // flag every section, since none of them is being refreshed
        const serverDown = Date.now() - Date.parse(manifest.generated_at) > MANIFEST_MAX_AGE_MS;
        for (const name of Object.keys(SECTION_RENDERERS)) {
            const info = (manifest.sections || {})[name];
            if (!info || !info.content_changed_at) continue;
            // Server-side failure or no fresh data: keep showing the last good content, flagged as possibly old
            const flag = sec => serverDown || info.ok === false || !!(sec && sec.stale);
            setSectionStale(name, flag(sectionData[name]));
            // Only download (and re-render) a section when its content changed since we last loaded it
            if (sectionChangedAt[name] === info.content_changed_at) continue;
            // Each section on its own: one failed download must not stop the others
            try {
                const sec = await fetchJson(`${SECTION_BASE_URL}/${name}.json?v=${encodeURIComponent(info.content_changed_at)}`);
                if (sec.schema_version !== SECTION_SCHEMA) { showRefreshNotice(); continue; }
                // Accept only the version the manifest announced (an upload still in progress gives the old file)
                if (sec.generated_at !== info.content_changed_at) { nextMs = 60 * 1000; continue; }
                sectionData[name] = sec;
                sectionChangedAt[name] = info.content_changed_at;
                setSectionStale(name, flag(sec));
                SECTION_RENDERERS[name](sec);
            } catch (err) {
                console.warn(`Section ${name} load error:`, err);
                nextMs = 60 * 1000;
            }
        }
        // The server rebuilds every ~6 min: poll 45 s after the next expected build. Clamped so a wrong
        // device clock can neither stall updates nor make us poll every minute forever.
        if (nextMs !== 60 * 1000) {
            const next = Date.parse(manifest.generated_at) + 6 * 60 * 1000 + 45 * 1000 - Date.now();
            nextMs = Math.min(Math.max(next, 60 * 1000), 7 * 60 * 1000);
        }
    } catch (err) {
        console.warn('Section load error:', err);
        nextMs = 60 * 1000;
    }
    sectionTimer = setTimeout(() => { if (!document.hidden) loadSections(); }, nextMs);
}

loadSections();
// One per-minute re-render from cached sections (no network): everything that depends on the clock
setInterval(whenVisible(() => {
    renderStationsHeaderTime();
    if (sectionData.stations) sectionData.stations.data.cards.forEach(updateStationStale);
    renderHourlyForecast();          // expire the "now" column, drop hours that have passed
    renderCurrentSection();          // gauge stages, this hour's rain chance, badge age
    renderMinutelyTimeline();        // strip follows the 15-min slots
    renderTmdAlerts();               // warnings that have ended disappear
}), 60 * 1000);


// Text from the server goes into innerHTML in a few renderers: escape whatever came from scraped sources
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Page title and header labels from the manifest's area info (server config/areas.json)
function applyAreaHeader(info) {
    if (!info) return;
    const setText = (el, v) => { if (el && v) el.innerText = v; };
    if (info.title) document.title = info.title + ' | Water & Radar Monitor';
    setText(document.querySelector('h1'), info.title);
    const subDesc = document.querySelector('header .dash-container p');
    if (subDesc) subDesc.remove();
    setText(document.querySelector('#weatherSection .panel-header .text-xs'), info.weather_source_label);
    setText(document.getElementById('radarTitle'), info.radar_title);
}

function renderStationsSection(sec) {
    const cards = sec.data.cards;
    renderStationsHeaderTime(sec.data.header_latest);
    const container = document.getElementById('dynamicStationsContainer');
    if (!container) return;
    
    // Cards arrive primary-first from the server
    let html = '';
    cards.forEach(st => {
        html += `
        <div id="stationCard-${st.id}" class="panel station-card" style="--accent: ${st.color};">
          <div class="panel-header">
            <div class="flex items-center gap-2 min-w-0">
              <span class="station-tag">${st.id}</span>
              <span class="font-bold text-white text-sm sm:text-base truncate">${st.short_name}</span>
              
            </div>
            <div class="flex flex-col items-end gap-0.5 shrink-0">
              <span id="statusBadge-${st.id}" class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 shadow-sm shrink-0">...</span>
              <span id="updateTime-${st.id}" class="text-[0.6rem] text-slate-400/80 font-medium tracking-wide"></span>
              <span id="staleBadge-${st.id}" class="lvl-stale" hidden></span>
            </div>
          </div>
          <div class="panel-body flex flex-col gap-2.5">
            <!-- Minimal level gauge: number + bar with threshold ticks (geometry from the server) -->
            <div class="lvl-block">
              <div class="lvl-top">
                <span id="currentLevelText-${st.id}" class="lvl-num">-.--</span>
                <span class="lvl-unit">ม.รทก.</span>
              </div>
              <div id="bankStatusText-${st.id}" class="lvl-bank">กำลังโหลด...</div>
              <div class="lvl-bar" id="lvlBar-${st.id}">
                <div class="lvl-fill" id="lvlFill-${st.id}"></div>
              </div>
              <div class="lvl-legend" id="lvlLegend-${st.id}"></div>
            </div>

            <div class="pt-2 border-t border-slate-800/80">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[0.7rem] text-slate-400 font-medium">📊 เปรียบเทียบการเปลี่ยนแปลง</span>
                <span id="trendDiffText-${st.id}" class="text-xs font-bold text-slate-200">--</span>
              </div>
              <div class="flex bg-slate-900/90 border border-slate-800 p-1 rounded-xl w-full">
                <button onclick="setStationTrendPeriod('${st.id}', 1)" id="btnTrend-${st.id}-1" class="trend-btn flex-1 py-1 text-[0.65rem] font-bold rounded-lg bg-blue-600 text-white shadow-sm transition-all">1 ชม.</button>
                <button onclick="setStationTrendPeriod('${st.id}', 3)" id="btnTrend-${st.id}-3" class="trend-btn flex-1 py-1 text-[0.65rem] font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-all">3 ชม.</button>
                <button onclick="setStationTrendPeriod('${st.id}', 6)" id="btnTrend-${st.id}-6" class="trend-btn flex-1 py-1 text-[0.65rem] font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-all">6 ชม.</button>
                <button onclick="setStationTrendPeriod('${st.id}', 12)" id="btnTrend-${st.id}-12" class="trend-btn flex-1 py-1 text-[0.65rem] font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-all">12 ชม.</button>
                <button onclick="setStationTrendPeriod('${st.id}', 24)" id="btnTrend-${st.id}-24" class="trend-btn flex-1 py-1 text-[0.65rem] font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-all">1 วัน</button>
              </div>
              <div id="trendDesc-${st.id}" class="text-[0.68rem] text-slate-400 text-center mt-1.5">กำลังคำนวณ...</div>
            </div>
          </div>
        </div>
        `;
    });
    const prevScroll = container.scrollLeft;
    container.innerHTML = html;
    container.scrollLeft = prevScroll;
    initStationCarouselDots(container);
    cards.forEach(st => { updateStationCard(st); setStationTrendPeriod(st.id, stationTrendPeriods[st.id] || 1); });
}

// Dots under the stations header follow the swipe position (phones only; hidden on desktop by CSS)
function initStationCarouselDots(container) {
    const dots = document.getElementById('stationDots');
    if (!dots) return;
    const cards = () => [...container.querySelectorAll('.station-card')];
    const currentIndex = () => {
        const center = container.scrollLeft + container.clientWidth / 2;
        let idx = 0, best = Infinity;
        cards().forEach((c, i) => {
            const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
            if (d < best) { best = d; idx = i; }
        });
        return idx;
    };
    const goTo = (i) => {
        const list = cards();
        const c = list[Math.max(0, Math.min(list.length - 1, i))];
        if (c) container.scrollTo({ left: c.offsetLeft - (container.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
    };

    // Dots are buttons: tap to jump to that station
    dots.innerHTML = [...container.querySelectorAll('.station-card')].map((_, i) => `<button type="button" aria-label="สถานีที่ ${i + 1}" class="${i === 0 ? 'active' : ''}"></button>`).join('');
    dots.querySelectorAll('button').forEach((b, i) => b.onclick = () => goTo(i));

    if (container.dataset.carouselBound === 'true') return;
    container.dataset.carouselBound = 'true';

    container.addEventListener('scroll', () => {
        const idx = currentIndex();
        dots.querySelectorAll('button').forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });

    // Mouse support (desktop browsers / device emulation). Touch swipes use native scrolling + snap.
    const isCarousel = () => getComputedStyle(container).display === 'flex';
    let wheelLock = false;
    container.addEventListener('wheel', (e) => {
        if (!isCarousel()) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) < 4) return;
        const idx = currentIndex();
        const next = idx + (delta > 0 ? 1 : -1);
        if (next < 0 || next >= cards().length) return; // let the page scroll at the ends
        e.preventDefault();
        if (wheelLock) return;
        wheelLock = true;
        goTo(next);
        setTimeout(() => { wheelLock = false; }, 450);
    }, { passive: false });

    let down = false, startX = 0, startScroll = 0, startIdx = 0, moved = false;
    container.addEventListener('mousedown', (e) => {
        if (!isCarousel() || e.button !== 0 || e.target.closest('button, a')) return;
        down = true; moved = false; startX = e.clientX; startScroll = container.scrollLeft; startIdx = currentIndex();
        container.style.scrollSnapType = 'none'; // snapping would fight the drag
        container.style.cursor = 'grabbing';
        e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
        if (!down) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 4) moved = true;
        container.scrollLeft = startScroll - dx;
    });
    window.addEventListener('mouseup', (e) => {
        if (!down) return;
        down = false;
        container.style.cursor = '';
        const dx = e.clientX - startX;
        const target = dx < -40 ? startIdx + 1 : (dx > 40 ? startIdx - 1 : startIdx);
        container.style.removeProperty('scroll-snap-type');
        goTo(target);
    });
    container.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
}
function updateStationCard(st) {
    const id = st.id, L = st.latest;
    const lvlEl = document.getElementById(`currentLevelText-${id}`);
    if (!L) {
        if (lvlEl) lvlEl.innerText = '-.--';
        const bt = document.getElementById(`bankStatusText-${id}`);
        if (bt) bt.innerText = 'ไม่มีข้อมูลระดับน้ำ';
        updateStationStale(st);
        return;
    }
    const g = L.gauge;
    if (lvlEl) { lvlEl.innerText = L.level_text; lvlEl.style.color = g.color; }

    const badgeClasses = { normal: 'bg-blue-950/80 text-blue-300 border border-blue-800/60',
                           warn: 'bg-orange-950/80 text-orange-300 border border-orange-800/60',
                           crit: 'bg-red-950/80 text-red-300 border border-red-800/60' }[L.status];
    const badgeEl = document.getElementById(`statusBadge-${id}`);
    if (badgeEl) {
        badgeEl.innerHTML = L.style.badge;
        badgeEl.className = `px-2.5 py-1 rounded-full text-xs font-bold shadow-sm ${badgeClasses}`;
    }
    const updateTimeEl = document.getElementById(`updateTime-${id}`);
    if (updateTimeEl) updateTimeEl.innerText = `เวลา ${L.time_hm} น.`;
    updateStationStale(st);

    const bankTextEl = document.getElementById(`bankStatusText-${id}`);
    if (bankTextEl) {
        bankTextEl.innerText = L.bank_text;
        bankTextEl.className = `lvl-bank${L.over_bank ? ' over' : ''}`;
    }

    const fill = document.getElementById(`lvlFill-${id}`);
    if (fill) { fill.style.width = `${g.fill_pct}%`; fill.style.background = g.color; }
    const bar = document.getElementById(`lvlBar-${id}`);
    if (bar) {
        bar.querySelectorAll('.lvl-tick').forEach(t => t.remove());
        g.ticks.forEach(t => bar.insertAdjacentHTML('beforeend',
            `<span class="lvl-tick" style="left:${t.pct}%;background:${t.color}" title="${t.label} ${t.value_text}"></span>`));
    }
    const legend = document.getElementById(`lvlLegend-${id}`);
    if (legend) legend.innerHTML = g.ticks.map(t =>
        `<span><i style="background:${t.color}"></i>${t.label} ${t.value_text}</span>`).join('');
}

// "No new data for X" badge per station: threshold from the server, age from this device's clock
function updateStationStale(st) {
    const el = document.getElementById(`staleBadge-${st.id}`);
    const L = st.latest;
    if (!el || !L || !L.at) { if (el) el.hidden = true; return; }
    const mins = Math.floor((Date.now() - Date.parse(L.at)) / 60000);
    if (mins < L.stale_after_min) { el.hidden = true; return; }
    const h = Math.floor(mins / 60);
    el.textContent = `⚠️ ไม่มีข้อมูลใหม่ ${h >= 24 ? Math.floor(h / 24) + ' วัน' : h >= 1 ? h + ' ชม.' : mins + ' นาที'}`;
    el.hidden = false;
}

// Header "อัปเดตล่าสุด": time from the server, "x นาทีที่แล้ว" from this device's clock
let headerLatest = null;
function renderStationsHeaderTime(latest) {
    if (latest !== undefined) headerLatest = latest;
    const latestTimeEl = document.getElementById('latestTime');
    const badge = document.getElementById('timeAgoBadge');
    if (!headerLatest) return;
    if (latestTimeEl) latestTimeEl.innerText = headerLatest.time_th;
    if (!badge) return;
    if (!headerLatest.at) { badge.classList.add('hidden'); return; }
    const diffMins = Math.max(0, Math.floor((Date.now() - Date.parse(headerLatest.at)) / 60000));
    badge.classList.remove('hidden', 'bg-emerald-950/80', 'text-emerald-400', 'border-emerald-800/60', 'bg-amber-950/80', 'text-amber-400', 'border-amber-800/60', 'bg-slate-800', 'text-slate-400', 'border-slate-700');
    if (diffMins < 60) {
        badge.innerText = `${diffMins} นาทีที่แล้ว`;
        badge.classList.add('bg-emerald-950/80', 'text-emerald-400', 'border', 'border-emerald-800/60');
    } else {
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 3) {
            badge.innerText = `${diffHours} ชั่วโมงที่แล้ว`;
            badge.classList.add('bg-amber-950/80', 'text-amber-400', 'border', 'border-amber-800/60');
        } else {
            const diffDays = Math.floor(diffHours / 24);
            badge.innerText = diffDays === 0 ? `${diffHours} ชั่วโมงที่แล้ว` : `${diffDays} วันที่แล้ว`;
            badge.classList.add('bg-slate-800', 'text-slate-400', 'border', 'border-slate-700');
        }
    }
}

// ===== Per-Station Trend Stepper Controls (values precomputed by the server for 1/3/6/12/24 h) =====
function setStationTrendPeriod(stationId, hours) {
    stationTrendPeriods[stationId] = hours;
    [1, 3, 6, 12, 24].forEach(p => {
        const btn = document.getElementById(`btnTrend-${stationId}-${p}`);
        if (!btn) return;
        btn.className = p === hours
            ? "trend-btn flex-1 py-1 text-[0.65rem] font-bold rounded-lg bg-blue-600 text-white shadow-sm transition-all"
            : "trend-btn flex-1 py-1 text-[0.65rem] font-medium rounded-lg text-slate-400 hover:text-slate-200 transition-all";
    });
    updateTrendDisplayForStation(stationId);
}

function updateTrendDisplayForStation(stationId) {
    const st = sectionData.stations && sectionData.stations.data.cards.find(c => c.id === stationId);
    const diffText = document.getElementById(`trendDiffText-${stationId}`);
    const descText = document.getElementById(`trendDesc-${stationId}`);
    if (!st || !diffText || !descText) return;
    const t = st.trends[String(stationTrendPeriods[stationId] || 1)];
    diffText.innerText = t.text;
    if (!t.available) {
        diffText.className = t.reason === 'no_data' ? "text-xs font-bold text-slate-200" : "text-xs font-bold text-slate-400";
        descText.innerText = t.desc;
        return;
    }
    diffText.className = 'text-xs font-bold ' + { up: 'text-red-400', down: 'text-sky-400', flat: 'text-slate-300' }[t.direction];
    descText.innerHTML = `${t.desc} เทียบกับ <span class="text-slate-300 font-semibold">${t.period}</span> ที่แล้ว`;
}

// ===== Water level history chart (time axis, range chips, station chips, threshold lines) =====
const HIST_RANGES = [{ h: 6, label: '6 ชม.' }, { h: 24, label: '24 ชม.' }, { h: 72, label: '3 วัน' }];
const THAI_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const THAI_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
let histRangeHours = 24;
try {
    const saved = parseInt(localStorage.getItem('hydoreus.histRange'), 10);
    if (HIST_RANGES.some(r => r.h === saved)) histRangeHours = saved;
} catch (e) { /* storage unavailable */ }

// Times from the server are absolute instants; always show Thai wall-clock time (UTC+7, no DST),
// whatever time zone the viewer's device is set to.
const BKK_OFFSET_MS = 7 * 3600 * 1000;
function bkk(ms) { return new Date(ms + BKK_OFFSET_MS); }   // read with getUTC*()

function fmtHistTime(ms, withDay) {
    const d = bkk(ms);
    const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    return withDay ? `${THAI_DOW[d.getUTCDay()]} ${d.getUTCDate()} ${THAI_MON[d.getUTCMonth()]} ${hm}` : hm;
}

// Draws dashed threshold lines and midnight separators behind the lines
const histDecorPlugin = {
    id: 'histDecor',
    beforeDatasetsDraw(chart, args, opts) {
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        ctx.save();
        // First Bangkok midnight after x.min
        const start = Math.floor((x.min + BKK_OFFSET_MS) / 86400000) * 86400000 + 86400000 - BKK_OFFSET_MS;
        for (let t = start; t < x.max; t += 86400000) {
            const px = x.getPixelForValue(t);
            ctx.strokeStyle = 'rgba(154,160,166,0.35)';
            ctx.setLineDash([2, 4]);
            ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
            const d = bkk(t);
            ctx.setLineDash([]);
            ctx.fillStyle = '#9aa0a6';
            ctx.font = `${IS_MOBILE ? 12 : 11}px Kanit, sans-serif`;
            ctx.fillText(`${THAI_DOW[d.getUTCDay()]} ${d.getUTCDate()}`, px + 4, a.top + 12);
        }
        (opts.lines || []).forEach(l => {
            if (l.value < y.min || l.value > y.max) return;
            const py = y.getPixelForValue(l.value);
            ctx.strokeStyle = l.color;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash(l.dash || [6, 5]);
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = l.color;
            ctx.font = `600 ${IS_MOBILE ? 12 : 11}px Kanit, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(l.label, a.right - 4, py - 5);
            ctx.textAlign = 'left';
            ctx.globalAlpha = 1;
        });
        ctx.restore();
    }
};

// Same palette as the station cards: normal / watch / critical
const STATUS_COLORS = { normal: '#38bdf8', warn: '#fb923c', crit: '#f43f5e' };

function renderHistControls(d, r) {
    const rangeEl = document.getElementById('histRange');
    if (rangeEl) {
        rangeEl.innerHTML = d.range_order.map(h =>
            `<button type="button" class="hist-chip${h === histRangeHours ? ' active' : ''}" data-h="${h}">${d.ranges[String(h)].label}</button>`).join('');
        rangeEl.querySelectorAll('button').forEach(b => b.onclick = () => {
            histRangeHours = parseInt(b.dataset.h, 10);
            try { localStorage.setItem('hydoreus.histRange', String(histRangeHours)); } catch (e) { /* storage unavailable */ }
            renderCombinedHistoryChart();
        });
    }
    const legendEl = document.getElementById('histLegend');
    if (!legendEl) return;
    const lg = r.legend, ch = lg.change, gap = lg.gap;
    legendEl.innerHTML = `
            <div class="hist-station" style="--c:${lg.color}">
                <span class="hist-dot"></span>
                <span class="hist-name">${d.station.short_name} (สถานี ${d.station.id}) · ล่าสุด</span>
                <span class="hist-val">${lg.value_text}</span>
                <span class="hist-change">${ch ? `<span style="color:${ch.color}">${ch.arrow} ${ch.cm} ซม.</span>` : ''}</span>
                <span class="hist-gap">${gap ? (gap.color ? `<span style="color:${gap.color}">${gap.text}</span>` : gap.text) : ''}</span>
            </div>`;
}

// Status code per point (n/w/c) from the server -> the same palette as the station cards
const HIST_SEG_COLORS = { n: STATUS_COLORS.normal, w: STATUS_COLORS.warn, c: STATUS_COLORS.crit };
const HIST_RANK = { n: 0, w: 1, c: 2 };

function renderCombinedHistoryChart() {
    const canvas = document.getElementById('historyChart');
    const sec = sectionData.history;
    if (!canvas || !sec) return;
    const d = sec.data;
    if (!d.ranges[String(histRangeHours)]) histRangeHours = d.default_range;
    const r = d.ranges[String(histRangeHours)];
    renderHistControls(d, r);

    const pts = d.points.slice(d.points.length - r.n_points);
    const data = pts.map(p => ({ x: p[0], y: p[1] }));
    const datasets = [{
        label: d.station.short_name,
        data,
        // Each segment takes the more severe status of its two ends (computed per point on the server)
        borderColor: r.line_color,
        segment: { borderColor: c => {
            const a = pts[c.p0DataIndex], b = pts[c.p1DataIndex];
            if (!a || !b) return r.line_color;
            return HIST_SEG_COLORS[HIST_RANK[a[2]] >= HIST_RANK[b[2]] ? a[2] : b[2]];
        } },
        pointHoverBackgroundColor: c => HIST_SEG_COLORS[(pts[c.dataIndex] || [0, 0, 'n'])[2]],
        borderWidth: 3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 8,
        tension: 0.25,
        spanGaps: 30 * 60000,
        fill: 'start',
        backgroundColor: ctx => {
            const { chart } = ctx;
            if (!chart.chartArea) return 'transparent';
            const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            g.addColorStop(0, r.line_color + '55');
            g.addColorStop(1, r.line_color + '00');
            return g;
        }
    }];
    const lines = r.lines;

    const caption = document.getElementById('histCaption');
    if (caption) caption.innerHTML = d.caption + (r.show_threshold_note ? d.caption_lines_note : '') + d.caption_tail;

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { datasets },
        plugins: [histDecorPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            parsing: false,
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            layout: { padding: { top: 8 } },
            plugins: {
                legend: { display: false },
                histDecor: { lines },
                tooltip: {
                    backgroundColor: 'rgba(32,33,36,0.95)', titleColor: '#e8eaed', bodyColor: '#e8eaed',
                    borderColor: '#5f6368', borderWidth: 1, padding: 12, boxPadding: 4, usePointStyle: true,
                    titleFont: { size: IS_MOBILE ? 14 : 12 }, bodyFont: { size: IS_MOBILE ? 14 : 12 },
                    callbacks: {
                        title: items => items.length ? fmtHistTime(items[0].parsed.x, true) : '',
                        label: item => ` ${item.dataset.label}: ${item.parsed.y.toFixed(2)} ม.`
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear', min: r.x_min, max: r.x_max,
                    grid: { color: 'rgba(60,64,67,0.5)', drawTicks: false },
                    border: { display: false },
                    ticks: {
                        color: '#9aa0a6', padding: 6, maxRotation: 0, autoSkip: true,
                        maxTicksLimit: IS_MOBILE ? 5 : 9,
                        stepSize: r.tick_step_ms,
                        callback: v => fmtHistTime(v, false)
                    }
                },
                y: {
                    suggestedMin: r.y_suggested_min, suggestedMax: r.y_suggested_max,
                    grid: { color: 'rgba(60,64,67,0.5)', drawTicks: false },
                    border: { display: false },
                    ticks: { color: '#9aa0a6', padding: 6, maxTicksLimit: 6, callback: v => v.toFixed(2) }
                }
            }
        }
    });
}


// ===== Nong Chok rain radar (TMD animated loop gif, hotlink-friendly) =====
const RADAR_URL = 'https://weather.tmd.go.th/pic_bmancLoop.gif';
const RADAR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let radarNextRefreshTime = Date.now() + RADAR_INTERVAL_MS;
let radarTimer = null;
let radarCountdownTimer = null;

function refreshRadar(manual = false) {
    const img = document.getElementById('radarImage');
    const err = document.getElementById('radarError');
    const txt = document.getElementById('radarUpdatedText');
    const icon = document.getElementById('radarRefreshIcon');
    if (!img) return;

    if (icon) icon.classList.add('animate-spin');

    const preloader = new Image();
    const newSrc = `${RADAR_URL}?t=${Math.floor(Date.now() / 60000)}`;

    preloader.onload = () => {
        img.src = newSrc;
        if (err) err.classList.add('hidden');
        if (icon) icon.classList.remove('animate-spin');
        if (txt) {
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            txt.innerText = `${timeStr} น.`;
        }
        radarNextRefreshTime = Date.now() + RADAR_INTERVAL_MS;
        updateRadarCountdown();
    };

    preloader.onerror = () => {
        if (icon) icon.classList.remove('animate-spin');
        if (!img.complete || img.naturalWidth === 0) {
            if (err) err.classList.remove('hidden');
        }
        radarNextRefreshTime = Date.now() + 60 * 1000;
        updateRadarCountdown();
    };

    preloader.src = newSrc;

    if (manual) {
        clearInterval(radarTimer);
        radarTimer = setInterval(() => refreshRadar(false), RADAR_INTERVAL_MS);
    }
}

function updateRadarCountdown() {
    const cdEl = document.getElementById('radarCountdownText');
    if (!cdEl) return;
    const remainingSec = Math.max(0, Math.round((radarNextRefreshTime - Date.now()) / 1000));
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    cdEl.innerText = `(อีก ${mins}:${String(secs).padStart(2, '0')})`;
}

function initRadarAutoRefresh() {
    refreshRadar();
    clearInterval(radarTimer);
    radarTimer = setInterval(() => refreshRadar(false), RADAR_INTERVAL_MS);
    clearInterval(radarCountdownTimer);
    radarCountdownTimer = setInterval(updateRadarCountdown, 1000);
}


// ===== Weather icons: Meteocons (Bas Milius, MIT) SVGs in ./icons — same look on every device =====
function wxImg(name, alt = '') {
    return `<img class="wx-icon" src="icons/${esc(name)}.svg" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}


// ===== "ตอนนี้" tab: everything computed by the server's current section =====
// Each op sets one property of one element; the page only picks what applies at its own clock.
function applyOps(ops) {
    (ops || []).forEach(o => {
        const el = document.getElementById(o.id);
        if (!el) return;
        if (o.prop === 'text') el.innerText = o.value;
        else if (o.prop === 'html') el.innerHTML = o.value;
        else if (o.prop === 'icon') el.innerHTML = wxImg(o.value.svg, o.value.alt);
        else if (o.prop === 'title') el.title = o.value;
        else if (o.prop === 'color') el.style.color = o.value;
    });
}

let currentRenderedKey = null;
function renderCurrentSection() {
    const sec = sectionData.current;
    if (!sec) return;
    const d = sec.data;
    const now = Date.now();
    // Rain-gauge correction: the stage that holds our clock (raining -> stopped/dry -> too old: none)
    const stage = (d.gauge_stages || []).findIndex(x => (!x.from || now >= Date.parse(x.from)) && now < Date.parse(x.until));
    // Rain chance / thunderstorm for the hour we are in (the server sends the previous hour .. +2)
    const hourStart = Math.floor(now / 3600000) * 3600000;
    const h = d.by_hour.findIndex(x => Date.parse(x.hour) === hourStart);
    const stale = !!d.badge && !!d.badge.stale_after && now > Date.parse(d.badge.stale_after);
    // Re-apply only when something visible changes (every minute would rebuild the icon <img> for nothing)
    const key = [sec.generated_at, stage, h, stale].join('|');
    if (key === currentRenderedKey) return;
    currentRenderedKey = key;
    applyOps(d.base);
    if (stage >= 0) applyOps(d.gauge_stages[stage].ops);
    applyOps(h >= 0 ? d.by_hour[h].ops : [{ id: 'weatherPopText', prop: 'text', value: '--' }, { id: 'weatherPopText', prop: 'title', value: '' },
                                          { id: 'weatherThunderText', prop: 'text', value: '--' }, { id: 'weatherThunderText', prop: 'color', value: '' },
                                          { id: 'weatherThunderHint', prop: 'text', value: '' }]);
    if (d.badge) setSourceBadge('currentSource', d.badge.text, d.badge.cls, stale);
}

function setSourceBadge(id, text, cls, stale = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerText = text;
    el.className = `src-badge ${cls}` + (stale ? ' stale' : '');
}


// Short-term rain: everything comes from the server's short_rain section. The page only follows the
// clock between builds: the strip starts at the current 15-min slot, earlier slots become "past".
function renderMinutelyTimeline() {
    const summaryEl = document.getElementById('minutelySummary');
    const sec = sectionData.short_rain;
    if (!summaryEl || !sec) return;
    const d = sec.data;
    const now = Date.now();

    const b = d.badge;
    const staleAfter = b.stale_after ? Date.parse(b.stale_after) : null;
    setSourceBadge('minutelySource', b.text, b.cls, b.always_stale || b.stale_now || (staleAfter !== null && now > staleAfter));

    const stripEl = document.getElementById('shortRainStrip');
    summaryEl.hidden = !!d.has_data;
    if (!d.has_data) { summaryEl.innerHTML = `<div class="text-xs gw-muted">${d.no_data_text}</div>`; if (stripEl) stripEl.innerHTML = ''; return; }
    if (!stripEl) return;

    const slot0 = Math.floor(now / 900000) * 900000;
    const tOf = x => Date.parse(x.t);
    const alive = x => x && (!x.valid_until || now < Date.parse(x.valid_until));
    const fcSlots = d.slots.filter(x => tOf(x) >= slot0).slice(0, d.n_slots);
    const firstFc = fcSlots.length ? tOf(fcSlots[0]) : slot0;
    // Past = measured gauge bins; slots that passed after the last build have no measurement yet ('-')
    const past = d.past_bins.filter(x => tOf(x) < firstFc);
    const lastPast = past.length ? tOf(past[past.length - 1]) : -Infinity;
    d.slots.filter(x => tOf(x) > lastPast && tOf(x) < firstFc)
        .forEach(x => past.push({ t: x.t, label: x.label, rain: 0, word: '-', svg: 'not-available', bar: null }));
    // "ตอนนี้" in the middle: as many past slots as the full forecast has after "ตอนนี้" (fixed, so the
    // layout does not shift when forecast slots run out between builds)
    const nPast = Math.max(d.n_slots - 1, 1);
    const cols = past.slice(-nPast).map(x => ({ label: x.label, sub: '', icon: wxImg(x.svg, x.word), rain: x.rain,
                                             rainLabel: x.word, barColor: x.bar || undefined, past: true }));
    const nowIndex = cols.length;
    // Rain at the gauges right now wins over the forecast for the current slot (until the readings get old)
    const ov = alive(d.now_override) ? d.now_override : null;
    fcSlots.forEach((x, i) => {
        const v = i === 0 && ov && ov.mmh > (x.mmh || 0) ? ov : x;
        cols.push({ label: i === 0 ? 'ตอนนี้' : x.label, sub: '', icon: wxImg(v.svg, v.word), rain: v.rain,
                    rainLabel: v.word, highlight: i === 0, barColor: v.bar || undefined });
    });

    const headEl = document.getElementById('shortRainHeadline');
    if (headEl) {
        const h = d.headlines.find(x => fcSlots.length && x.slot === fcSlots[0].t);
        // No variant for this slot: the server has not rebuilt for a while (manifest stale flag shows too)
        const head = h ? (ov ? h.text : h.text_forecast) : '⚠️ ข้อมูลฝนระยะสั้นยังไม่อัปเดต';
        let seen = '';
        if (alive(d.seen) && d.seen.code === 'raining') {
            const mins = d.seen.started_at ? Math.round((now - Date.parse(d.seen.started_at)) / 60000) : 0;
            seen = `สถานีวัดฝนใกล้บ้าน: ฝนกำลังตก${mins ? ` (เริ่มเมื่อ ~${mins} นาทีก่อน)` : ''}${d.seen.trend ? ` · ${d.seen.trend}` : ''}`;
        } else if (alive(d.seen)) {
            seen = d.seen.text;
        }
        // Rain at the farther gauges / where it is moving (server text, already in plain words)
        const around = ((d.around && d.around.lines) || []).filter(alive)
            .map(l => `<div class="short-rain-seen">${l.code === 'movement' ? '🧭' : '📍'} ${l.text}</div>`).join('');
        headEl.innerHTML = `${head}${seen ? `<div class="short-rain-seen">🌧️ ${seen}</div>` : ''}${around}`;
    }
    // Fixed scale (heavy rain = full bar) so a drizzle never looks like a downpour
    renderColumnStrip(stripEl, cols, { minRainScale: 10, fill: true, anchorIndex: nowIndex, anchorCenter: true });
}


function scrollSection(containerId, offset) {
    const el = document.getElementById(containerId);
    if (el) {
        el.scrollBy({ left: offset, behavior: 'smooth' });
    }
}

function enableHorizontalWheelAndDrag(el) {
    if (!el || el.dataset.scrollEnabled === 'true') return;
    el.dataset.scrollEnabled = 'true';

    // Vertical mouse wheel scrolls the strip horizontally
    el.addEventListener('wheel', (e) => {
        if (el.scrollWidth > el.clientWidth) {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                const maxScrollLeft = el.scrollWidth - el.clientWidth;
                const canScrollRight = e.deltaY > 0 && el.scrollLeft < maxScrollLeft - 1;
                const canScrollLeft = e.deltaY < 0 && el.scrollLeft > 1;
                if (canScrollRight || canScrollLeft) {
                    e.preventDefault();
                    el.scrollLeft += e.deltaY * 1.25;
                }
            }
        }
    }, { passive: false });

    let isDown = false;
    let startX = 0;
    let scrollStart = 0;
    let hasMoved = false;

    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, a')) return;
        isDown = true;
        hasMoved = false;
        startX = e.pageX - el.offsetLeft;
        scrollStart = el.scrollLeft;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
    });

    const endDrag = () => {
        if (!isDown) return;
        isDown = false;
        el.style.cursor = 'grab';
        el.style.removeProperty('user-select');
    };

    el.addEventListener('mouseleave', endDrag);
    el.addEventListener('mouseup', endDrag);

    el.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        const x = e.pageX - el.offsetLeft;
        if (Math.abs(x - startX) > 4) {
            hasMoved = true;
        }
        const walk = (x - startX) * 1.5;
        el.scrollLeft = scrollStart - walk;
    });

    // Suppress click on cards if dragging was performed
    el.addEventListener('click', (e) => {
        if (hasMoved) {
            e.stopPropagation();
            hasMoved = false;
        }
    }, true);

    el.style.cursor = 'grab';
}


// ===== Official TMD weather warnings (Thai, data.tmd.go.th WeatherWarningNews v2) =====
function renderTmdAlerts() {
    const el = document.getElementById('tmdAlerts');
    const sec = sectionData.warning;
    if (!el || !sec) return;
    const now = Date.now();
    // Sent newest-first and not yet ended at build time; re-check the end against this device's clock
    const active = sec.data.warnings.filter(w => !w.end || Date.parse(w.end) > now).slice(0, 1);
    if (!active.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = active.map(w => {
        const upcoming = w.start && Date.parse(w.start) > now;
        return `
            <div class="tmd-alert">
                <div class="tmd-alert-head">⚠️ ประกาศกรมอุตุนิยมวิทยา${upcoming ? ' <span class="tmd-alert-soon">(ยังไม่เริ่มมีผล)</span>' : ''}</div>
                <div class="tmd-alert-title">${esc(w.title)}</div>
                ${w.headline ? `<details class="tmd-alert-more"><summary>อ่านรายละเอียด</summary><p class="tmd-alert-text">${esc(w.headline)}</p></details>` : ''}
                <div class="tmd-alert-time">มีผล: ${w.start_text} – ${w.end_text}</div>
                <div class="tmd-alert-links">
                    ${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">อ่านประกาศฉบับเต็ม (PDF)</a>` : ''}
                    ${w.contact ? `<span>${esc(w.contact)}</span>` : ''}
                </div>
            </div>`;
    }).join('');
}


// ===== Column strip (phone-weather style): time / icon / temp line / rain % / rain bars =====
// cols: [{ label, sub, icon, temp, pop, rain, rainLabel, highlight, warn, onTap }]
const STRIP_COL_W = 64;

function renderColumnStrip(container, cols, opts = {}) {
    const prevScroll = container.scrollLeft;
    // opts.fill: stretch columns to the container width when they would not fill it (e.g. 7-day on PC)
    const colW = opts.fill && container.clientWidth ? Math.max(STRIP_COL_W, Math.floor(container.clientWidth / cols.length)) : STRIP_COL_W;
    const w = cols.length * colW;
    const showTemp = cols.some(c => typeof c.temp === 'number');
    const showLow = cols.some(c => typeof c.tempLow === 'number');
    const showSub = cols.some(c => c.sub);
    const showPop = cols.some(c => typeof c.pop === 'number');
    const maxRain = Math.max(opts.minRainScale || 1, ...cols.map(c => c.rain || 0));
    const BAR_H = 64;

    // Temperature polyline across columns
    let svg = '';
    if (showTemp) {
        const temps = cols.flatMap(c => [c.temp, c.tempLow]).filter(t => typeof t === 'number');
        const tMin = Math.min(...temps), tMax = Math.max(...temps);
        const yOf = t => 30 - (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * 24;
        const line = (key, color) => {
            const pts = cols.map((c, i) => typeof c[key] === 'number' ? [i * colW + colW / 2, yOf(c[key])] : null).filter(Boolean);
            const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
            return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>` +
                pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#e8eaed"/>`).join('');
        };
        svg = `<svg class="strip-line" width="${w}" height="36" viewBox="0 0 ${w} 36">
            ${line('temp', '#fdd663')}${showLow ? line('tempLow', '#8ab4f8') : ''}
        </svg>`;
    }

    const colHtml = cols.map((c, i) => {
        const h = c.rain > 0 ? Math.max(3, Math.round((c.rain / maxRain) * BAR_H)) : 0;
        return `
        <div class="strip-col${c.highlight ? ' now' : ''}${c.past ? ' past' : ''}${opts.selected === i ? ' sel' : ''}" data-i="${i}" style="width:${colW}px">
            <div class="strip-time">${c.warn ? '<span class="strip-warn" title="ฝนตกจริงอยู่ พยากรณ์อาจคลาด">⚠️</span>' : ''}${c.label}</div>
            ${showSub ? (c.sub ? `<div class="strip-sub">${c.sub}</div>` : '<div class="strip-sub">&nbsp;</div>') : ''}
            ${c.icon !== undefined ? `<div class="strip-icon">${c.icon}</div>` : ''}
            ${showTemp ? `<div class="strip-temp">${typeof c.temp === 'number' ? Math.round(c.temp) + '°' : ''}</div><div class="strip-line-gap"></div>` : ''}
            ${showLow ? `<div class="strip-temp low">${typeof c.tempLow === 'number' ? Math.round(c.tempLow) + '°' : ''}</div>` : ''}
            ${showPop ? `<div class="strip-pop">${typeof c.pop === 'number' ? '💧' + Math.round(c.pop * 100) + '%' : '&nbsp;'}</div>` : ''}
            <div class="strip-bar-wrap" style="height:${BAR_H}px">${h ? `<div class="strip-bar" style="height:${h}px;background:${c.barColor || 'linear-gradient(180deg,#8ab4f8,rgba(138,180,248,.25))'}"></div>` : ''}</div>
            <div class="strip-mm">${c.rainLabel !== undefined ? c.rainLabel : (c.rain || 0).toFixed(1)}</div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="strip-inner" style="width:${w}px">${svg}<div class="strip-cols">${colHtml}</div></div>`;
    container.scrollLeft = prevScroll;
    // First time: start the view at the anchor column (e.g. "now" after the past columns)
    if (typeof opts.anchorIndex === 'number' && container.dataset.anchored !== '1' && container.clientWidth) {
        // anchorCenter: the anchor column in the middle of the view; otherwise half a column from the left
        container.scrollLeft = Math.max(0, opts.anchorCenter
            ? opts.anchorIndex * colW + colW / 2 - container.clientWidth / 2
            : opts.anchorIndex * colW - colW / 2);
        container.dataset.anchored = '1';
    }

    // Place the temperature line between the temp row and the rain % row
    const line = container.querySelector('.strip-line');
    const gap = container.querySelector('.strip-line-gap');
    if (line && gap) line.style.top = (gap.offsetTop - 2) + 'px';

    container.querySelectorAll('.strip-col').forEach(el => el.addEventListener('click', () => {
        const i = parseInt(el.dataset.i, 10);
        if (cols[i].onTap) cols[i].onTap(i);
    }));
    enableHorizontalWheelAndDrag(container);
}

let hourlySelected = 1;

let hourlyRenderedKey = null;
// force: new data or the tab just became visible; the per-minute timer redraws only when the clock
// changed what is shown (the "now" column expired or an hour passed)
function renderHourlyForecast(force) {
    const container = document.getElementById('hourlyForecastContainer');
    const detailEl = document.getElementById('hourlyDetail');
    const sec = sectionData.hourly;
    if (!container || !sec) return;
    const d = sec.data;
    const nowMs = Date.now();
    const key = [sec.generated_at, !!(d.now && Date.parse(d.now.valid_until) > nowMs),
                 d.hours.filter(h => Date.parse(h.at) + 3600000 > nowMs).length].join('|');
    if (!force && key === hourlyRenderedKey) return;
    hourlyRenderedKey = key;
    const srcEl = document.getElementById('hourlySource');
    if (srcEl && d.source_label) srcEl.innerText = d.source_label;
    const cols = [];
    const details = [];
    // Observations stop counting as "now" after their own age limit, even if no newer build arrives
    const n = d.now && Date.parse(d.now.valid_until) > nowMs ? d.now : null;
    if (n) {
        cols.push({ label: 'ตอนนี้', sub: '', icon: wxImg(n.icon, n.icon_alt), temp: n.temp, pop: null, rain: n.rain,
                    rainLabel: n.rain_label, barColor: n.bar_color || undefined, highlight: true, warn: n.warn });
        const x = n.detail;
        details.push(`<b>ตอนนี้ (ข้อมูลจริง)</b> · ${esc(x.name)} ${x.raining ? '· ฝนกำลังตก' : ''}<br>${x.rain_line}` +
            (x.missed_text ? `<br><span style="color:#fbbf24">⚠️ ${x.missed_text}</span>` : ''));
    }
    // Hours that have fully passed (page left open while the server could not rebuild) are dropped here
    d.hours.filter(h => Date.parse(h.at) + 3600000 > nowMs).forEach(h => {
        cols.push({ label: h.label, sub: '', icon: wxImg(h.icon, h.icon_alt), temp: h.temp, pop: h.pop, rain: h.rain,
                    rainLabel: h.level.short, barColor: h.bar_color || undefined });
        details.push(`<b>${h.label} น.</b> · <span style="color:${h.level.color}">${h.level.text}</span>` +
            `<div class="strip-detail-grid"><span>TMD (สภาพ)</span><span>${h.tmd.icon} ${esc(h.tmd.name)}</span>` +
            h.sources.map(x => `<span>${esc(x.name)}</span><span style="color:${x.wet ? '#8ab4f8' : '#9aa0a6'}">${x.rain_text} มม.${x.pop_pct !== null ? ' · ' + x.pop_pct + '%' : ''}</span>`).join('') +
            `</div>`);
    });
    if (d.empty || !cols.length) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-2">ไม่มีข้อมูลรายชั่วโมง</div>';
        if (detailEl) detailEl.innerHTML = '';
        return;
    }

    if (hourlySelected >= cols.length) hourlySelected = 0;
    const draw = () => {
        cols.forEach(c => { c.onTap = i => { hourlySelected = i; draw(); }; });
        renderColumnStrip(container, cols, { selected: hourlySelected, minRainScale: 2 });
        if (detailEl) detailEl.innerHTML = details[hourlySelected] || '';
    };
    draw();
}

let dailySelected = 0;


// Re-fit the 7-day strip when the window size changes
let dailyResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(dailyResizeTimer);
    dailyResizeTimer = setTimeout(() => { renderDailyForecast(); renderMinutelyTimeline(); }, 200);
});

function renderDailyForecast() {
    const container = document.getElementById('dailyForecastContainer');
    const detailEl = document.getElementById('dailyDetail');
    const sec = sectionData.daily;
    if (!container || !sec) return;
    const dailyEl = document.getElementById('dailySource');
    if (dailyEl) dailyEl.innerText = sec.data.source_label;
    const days = sec.data.days;
    if (!days.length) {
        container.innerHTML = '<div class="text-xs text-slate-500 py-2">ไม่มีข้อมูลรายวัน</div>';
        return;
    }
    const cols = days.map(d => ({
        label: d.label, sub: d.date, icon: wxImg(d.icon, d.icon_alt), temp: d.temp, tempLow: d.temp_low,
        rain: d.rain, highlight: d.highlight, rainLabel: d.rain_label, barColor: d.bar_color || undefined
    }));
    const details = days.map(d => {
        const x = d.detail;
        return `<b>${d.label} ${d.date}</b> · ${x.cond_emoji} ${x.cond_name}` +
            `<div class="strip-detail-grid"><span>อุณหภูมิ</span><span>สูงสุด ${x.tmax_text}° · ต่ำสุด ${x.tmin_text}°</span>` +
            `<span>ฝนทั้งวัน</span><span>${x.rain_text} มม. (${x.rain_word})</span>` +
            `<span>ความชื้น</span><span>${x.rh_text} %</span></div>`;
    });
    if (dailySelected >= cols.length) dailySelected = 0;
    const draw = () => {
        cols.forEach(c => { c.onTap = i => { dailySelected = i; draw(); }; });
        renderColumnStrip(container, cols, { selected: dailySelected, minRainScale: 10, fill: true });
        if (detailEl) detailEl.innerHTML = details[dailySelected] || '';
    };
    draw();
}


// Monotone cubic path through points [[x, y], ...] (Fritsch–Carlson): smooth, but never swings above or
// below the data (a rain line must not dip under zero between two dry bins)
function smoothPath(pts) {
    if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : '';
    const n = pts.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
        if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
        const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
        if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
        const h = dx[i] / 3;
        d += ` C${(pts[i][0] + h).toFixed(2)} ${(pts[i][1] + t[i] * h).toFixed(2)} ${(pts[i + 1][0] - h).toFixed(2)} ${(pts[i + 1][1] - t[i + 1] * h).toFixed(2)} ${pts[i + 1][0].toFixed(2)} ${pts[i + 1][1].toFixed(2)}`;
    }
    return d;
}

// Rain per 15 minutes at one gauge over the last 3 h as a smooth line (like the hourly strip's line), on the
// same y-scale for every gauge; gaps where the gauge sent nothing. Only the SVG stretches with the card.
function gaugeSparkline(series, maxMm) {
    if (!series || !series.length) return '<div class="gauge-spark-empty">ไม่มีข้อมูลราย 5 นาที</div>';
    const H = 44, TOP = 4;
    const xp = i => (series.length === 1 ? 50 : i * 100 / (series.length - 1));
    const yp = mm => TOP + (1 - Math.min(mm, maxMm) / maxMm) * (H - TOP);
    let line = '', area = '', run = [];
    const flush = () => {
        if (run.length) {
            const d = smoothPath(run);
            line += d + ' ';
            area += `${d} L${run[run.length - 1][0].toFixed(2)} ${H} L${run[0][0].toFixed(2)} ${H} Z `;
        }
        run = [];
    };
    series.forEach((b, i) => { if (b.mm === null) flush(); else run.push([xp(i), yp(b.mm)]); });
    flush();
    const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1].map((i, k) =>
        `<span class="spark-tick ${['first', 'mid', 'last'][k]}" style="left:${xp(i)}%">${series[i].label}</span>`).join('');
    return `<div class="gauge-spark" style="height:${H + 14}px">
        <svg viewBox="0 0 100 ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="ปริมาณฝนทุก 15 นาที ย้อนหลัง 3 ชม.">
            <line x1="0" x2="100" y1="${H}" y2="${H}" class="spark-base"/>
            <path d="${area}" class="spark-area"/><path d="${line}" class="spark-line"/>
        </svg>${ticks}</div>`;
}

// ===== Flood-risk box: everything computed by the server's risk section =====
function renderRiskSection(sec) {
    const box = document.getElementById('weatherAlertBox');
    if (!box || !sec) return;
    const d = sec.data, b = d.banner, w = d.water, g = d.gauges;
    // One card per gauge: name, distance and a status badge, then its 15-minute rain line (shared scale)
    const rows = g.rows.map(r => `
                        <div class="gauge-card${r.fresh ? '' : ' gauge-old'}">
                            <div class="gauge-head">
                                <a href="https://weather.bangkok.go.th/rain/StationDetail?id=${encodeURIComponent(r.id)}&lang=th" target="_blank" rel="noopener" class="gauge-name" title="ดูข้อมูลสด สถานี ${esc(r.id)} กทม.">${esc(r.name)} ↗</a>
                                <span class="gauge-status" style="color:${r.status.color};border-color:${r.status.color}55"><img src="icons/${esc(r.status.icon)}.svg" alt="">${esc(r.status.text)}</span>
                            </div>
                            <div class="gauge-sub">${esc([r.district, r.where].filter(Boolean).join(' · '))}${r.fresh ? '' : ` · วัดเมื่อ ${esc(r.time_th || '-')} (ไม่นับในความเสี่ยง)`}</div>
                            <div class="gauge-sub">ฝนสะสม 24 ชม. <b style="color:${esc(r.rain24_color)}">${esc(r.rain24_text)}</b> ${g.unit}</div>
                            ${gaugeSparkline(r.series, g.series_max_mm)}
                            <div class="gauge-now">ฝน 15 นาทีล่าสุด <b>${esc(r.rain15_text)}</b> ${g.unit}</div>
                        </div>`).join('') || '<div class="text-xs text-slate-500 p-2">ไม่มีข้อมูลสถานีวัดฝน</div>';
    const gaugeTime = (g.rows.find(r => r.fresh) || {}).time_hm;

    box.innerHTML = `
        <div class="flex flex-col gap-3">
            <div class="p-3.5 sm:p-4 rounded-xl border ${b.border_class} ${b.bg_gradient} transition-all">
                <div class="flex items-start gap-3">
                    <span class="text-3xl sm:text-4xl shrink-0 mt-0.5">${b.icon}</span>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2 mb-1.5">
                            <span class="font-bold text-white text-sm sm:text-base">${b.title}</span>
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold ${b.badge_class}">${b.badge}</span>
                        </div>
                        <p class="text-xs sm:text-sm text-slate-200 leading-relaxed font-normal">
                            ${b.summary}
                        </p>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs sm:text-sm">
                <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800/90 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-1.5 font-bold text-slate-100">
                                <span>🌊</span> ระดับน้ำ${esc(w.station_name)}
                            </div>
                            <span class="text-[11px] px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/60 font-semibold">สถานี ${w.station_id}</span>
                        </div>
                        <div class="flex items-baseline gap-2 mb-2">
                            <span class="text-2xl font-black" style="color:${w.level_color}" title="สีตามสถานะ: ฟ้า ปกติ · ส้ม เฝ้าระวัง · แดง วิกฤต">${w.level_text}</span>
                            <span class="text-xs text-slate-400">ม.รทก.</span>
                            <span class="text-xs font-bold ${w.trend1h_class}">1 ชม: ${w.trend1h_text}</span>
                        </div>
                        <div class="space-y-1 text-slate-300 text-xs">
                            <div class="flex justify-between">
                                <span class="text-slate-400">แนวโน้ม 3 ชม.:</span>
                                <span class="font-bold ${w.trend3h_class}">${w.trend3h_text}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-400">สถานะคลอง:</span>
                                <span class="font-bold ${w.canal_class}">${w.canal_text}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-slate-400">ความสูงตลิ่ง:</span>
                                <span class="text-slate-300">${w.bank_text}</span>
                            </div>
                        </div>
                    </div>
                    <div class="mt-2.5 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                        <span>${esc(w.short_name)}</span>
                        <span class="${w.trend1h_class} font-semibold">${w.trend_tag}</span>
                    </div>
                </div>

                <div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800/90 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-1.5 font-bold text-slate-100">
                                <span>📡</span> ${g.title}
                            </div>
                            <span class="text-[11px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/60 font-semibold">กทม.${gaugeTime ? ` · ${gaugeTime} น.` : ''}</span>
                        </div>
                        <div class="text-[11px] text-slate-400 mb-2">กราฟ: ปริมาณฝนทุก 15 นาที ย้อนหลัง 3 ชม. (ทุกสถานีสเกลเดียวกัน) · เรียงจากสถานีที่ใกล้ที่สุด</div>
                        <div class="gauge-list">${rows}
                        </div>
                    </div>
                    <div class="mt-2.5 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                        <span>ขีดระบายน้ำ กทม. 60 มม.</span>
                        <span class="${g.tag_class} font-semibold">${g.tag_text}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}


// ===== Weather panel tabs (ปัจจุบัน / รายชั่วโมง / 7 วัน) =====
function initWeatherTabs() {
    const tabs = document.querySelectorAll('#weatherSection .gw-tab');
    const panes = document.querySelectorAll('#weatherSection .gw-pane');
    const select = (name) => {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
        panes.forEach(p => { p.hidden = p.dataset.pane !== name; });
        // Strips measure their layout, so redraw once the pane is visible
        if (name === 'hourly') renderHourlyForecast(true);
        if (name === 'daily') renderDailyForecast();
        if (name === 'now') renderMinutelyTimeline();
        try { localStorage.setItem('hydoreus.weatherTab', name); } catch (e) { /* storage unavailable */ }
    };
    tabs.forEach(t => t.addEventListener('click', () => select(t.dataset.tab)));
    let saved = null;
    try { saved = localStorage.getItem('hydoreus.weatherTab'); } catch (e) { /* storage unavailable */ }
    if (saved && document.querySelector(`#weatherSection .gw-tab[data-tab="${saved}"]`)) select(saved);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initWeatherTabs();
        initRadarAutoRefresh();
    });
} else {
    initWeatherTabs();
    initRadarAutoRefresh();
}


// Catch up immediately when the tab becomes visible again
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadSections();
});


