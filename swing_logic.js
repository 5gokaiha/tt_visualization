(function() {
    let dataBuffer = [];
    let isStepping = false;
    let peakTotalAcc = 0;
    let peakAngX = 0;
    let peakAngY = 0;
    let lastStepTime = 0;

    let isRunning = false; 
    let totalKcal = 0.0;
    let totalDistance = 0.0;
    let totalSteps = 0;
    let currentPitch = 0; 
    
    let allStepsData = [];
    let dropHistory = [];
    
    let isCalibrating = false;
    let calibSamples = [];
    let offsetAngX = 0, offsetAngY = 0, offsetAngZ = 0;

    const pitchTimestamps = [];
    let pitchChart, distributionChart, dropChart;
    let pitchPie, distPie, dropPie;
    
    let analysisTimelineChart, analysisTiltChart, analysisCorrelationChart, analysisBalanceChart, analysisPieChart;

    const statsCount = { pitch: { good: 0, warn: 0, bad: 0 }, form: { good: 0, warn: 0, bad: 0 }, drop: { good: 0, warn: 0, bad: 0 } };
    
    const colorGood = '#28a745', colorWarn = '#ffc107', colorBad = '#dc3545';
    let adviceTimer = 0;

    // 円グラフ内に文字を描画するカスタムプラグイン (文字を読みやすく拡大)
    const pieTextPlugin = {
        id: 'pieText',
        afterDraw: (chart) => {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                if(meta.hidden) return;
                const total = dataset.data.reduce((a,b)=>a+b, 0);
                meta.data.forEach((sector, j) => {
                    const val = dataset.data[j];
                    if(val === 0 || total === 0) return;
                    const pct = Math.round(val / total * 100);
                    if(pct < 10) return;
                    
                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 10px sans-serif'; 
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    
                    const center = sector.tooltipPosition();
                    const labels = ['Good', 'Warn', 'Bad'];
                    ctx.fillText(labels[j], center.x, center.y - 6);
                    ctx.fillText(pct + '%', center.x, center.y + 6);
                    ctx.restore();
                });
            });
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('calibBtn').addEventListener('click', () => {
            isCalibrating = true; calibSamples = [];
            window.logMessage("補正中... 動かないでください");
        });
        document.getElementById('toggleBtn').addEventListener('click', (e) => {
            isRunning = !isRunning;
            e.target.textContent = isRunning ? "停止" : "開始";
            e.target.style.backgroundColor = isRunning ? "var(--record-color)" : "var(--color-step)";
            window.logMessage(isRunning ? "解析を開始しました" : "解析を一時停止しました");
            if(isRunning) document.getElementById('advice-box').textContent = "計測中...ペースを掴みましょう";
        });

        document.getElementById('tab-live').addEventListener('click', () => {
            document.getElementById('tab-live').classList.add('active');
            document.getElementById('tab-analysis').classList.remove('active');
            document.getElementById('view-live').classList.add('active');
            document.getElementById('view-analysis').classList.remove('active');
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        });
        document.getElementById('tab-analysis').addEventListener('click', () => {
            document.getElementById('tab-analysis').classList.add('active');
            document.getElementById('tab-live').classList.remove('active');
            document.getElementById('view-analysis').classList.add('active');
            document.getElementById('view-live').classList.remove('active');
            updateAnalysisView(); 
            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
        });

        initCharts();
        setInterval(updatePitch, 1000);
    });
    
    function initCharts() {
        const pitchBgPlugin = {
            id: 'pitchBgPlugin',
            beforeDraw: (chart) => {
                const ctx = chart.ctx; const yAxis = chart.scales.y; const xAxis = chart.scales.x;
                const pitchMin = parseFloat(document.getElementById('pitchMin').value) || 170;
                const pitchMax = parseFloat(document.getElementById('pitchMax').value) || 190;
                const topY = yAxis.getPixelForValue(pitchMax); const bottomY = yAxis.getPixelForValue(pitchMin);
                ctx.save(); ctx.fillStyle = 'rgba(40, 167, 69, 0.1)'; 
                ctx.fillRect(xAxis.left, topY, xAxis.right - xAxis.left, bottomY - topY); ctx.restore();
            }
        };

        const commonAxisOpt = { ticks: {font:{size:8}, padding:2} };

        const ctxPitch = document.getElementById('pitch-chart').getContext('2d');
        pitchChart = new Chart(ctxPitch, {
            type: 'line', plugins: [pitchBgPlugin],
            data: { datasets: [{ label: 'Pitch', data: [], borderColor: colorGood, borderWidth: 1.5, tension: 0.3, pointRadius: 1.5, pointBackgroundColor: (ctx) => ctx.raw ? ctx.raw.color : colorGood }] },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { x: { type: 'time', time: { unit: 'second', displayFormats: { second: 'HH:mm' } }, ticks: { maxRotation: 0, font:{size:8}, padding:2 } }, y: { min: 120, max: 220, ...commonAxisOpt } }, plugins: { legend: { display: false } } }
        });

        const ctxDist = document.getElementById('distribution-chart').getContext('2d');
        distributionChart = new Chart(ctxDist, {
            type: 'scatter',
            data: { datasets: [{ label: 'Step', data: [], pointBackgroundColor: (ctx) => ctx.raw ? ctx.raw.bgColor : colorGood, pointRadius: 2 }] },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { x: { title: { display: true, text: '前傾(°)', font:{size:9}, padding:0 }, ...commonAxisOpt }, y: { title: { display: true, text: '衝撃(G)', font:{size:9}, padding:0 }, ...commonAxisOpt } }, plugins: { legend: { display: false } } }
        });

        const ctxDrop = document.getElementById('drop-chart').getContext('2d');
        dropChart = new Chart(ctxDrop, {
            type: 'line',
            data: { 
                labels: [], 
                datasets: [
                    { label: '左下がり', data: [], borderColor: '#1976d2', backgroundColor: '#1976d2', pointRadius: 1.5, borderWidth: 1.5, spanGaps: true, tension: 0.3 },
                    { label: '右下がり', data: [], borderColor: colorBad, backgroundColor: colorBad, pointRadius: 1.5, borderWidth: 1.5, spanGaps: true, tension: 0.3 }
                ] 
            },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { y: { min: 0, max: 15, title: {display: true, text: '|°|', font:{size:8}, padding:0}, ticks: {font:{size:8}, padding:2} }, x: {ticks:{font:{size:8}}} }, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 8, padding: 4, font: {size: 8} } } } }
        });

        const pieOpts = { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, plugins: { pieTextPlugin, legend: { display: false }, tooltip: { enabled: false } }, cutout: '50%' };
        pitchPie = new Chart(document.getElementById('pitch-pie').getContext('2d'), { type: 'doughnut', plugins: [pieTextPlugin], data: { labels: ['Good', 'Warn', 'Bad'], datasets: [{ data: [0,0,0], backgroundColor: [colorGood, colorWarn, colorBad], borderWidth: 0 }] }, options: pieOpts });
        distPie = new Chart(document.getElementById('dist-pie').getContext('2d'), { type: 'doughnut', plugins: [pieTextPlugin], data: { labels: ['Good', 'Warn', 'Bad'], datasets: [{ data: [0,0,0], backgroundColor: [colorGood, colorWarn, colorBad], borderWidth: 0 }] }, options: pieOpts });
        dropPie = new Chart(document.getElementById('drop-pie').getContext('2d'), { type: 'doughnut', plugins: [pieTextPlugin], data: { labels: ['Good', 'Warn', 'Bad'], datasets: [{ data: [0,0,0], backgroundColor: [colorGood, colorWarn, colorBad], borderWidth: 0 }] }, options: pieOpts });

        // --- 事後分析用グラフ ---
        analysisTimelineChart = new Chart(document.getElementById('analysis-timeline-chart'), {
            type: 'line',
            data: { datasets: [
                { label: 'ピッチ(spm)', data: [], borderColor: colorGood, borderWidth: 1.5, yAxisID: 'y', pointRadius: 0, tension: 0.2 },
                { label: '着地衝撃(G)', data: [], borderColor: colorWarn, borderWidth: 1.5, yAxisID: 'y1', pointRadius: 0, tension: 0.2 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { x: { type: 'time', time: { unit: 'minute'}, ticks:{font:{size:8}, padding:2} }, y: { type: 'linear', position: 'left', min: 120, max: 220, ticks:{font:{size:8}, padding:2} }, y1: { type: 'linear', position: 'right', min: 0, max: 5, ticks:{font:{size:8}, padding:2} } }, plugins: { legend: { labels: {font:{size:8}, boxWidth:8, padding:4} } } }
        });

        const tiltBgPlugin = {
            id: 'tiltBgPlugin',
            beforeDraw: (chart) => {
                const ctx = chart.ctx; const yAxis = chart.scales.y; const xAxis = chart.scales.x;
                const tiltMin = parseFloat(document.getElementById('tiltMin').value) || 5;
                const tiltMax = parseFloat(document.getElementById('tiltMax').value) || 15;
                const topY = yAxis.getPixelForValue(tiltMax); const bottomY = yAxis.getPixelForValue(tiltMin);
                ctx.save(); ctx.fillStyle = 'rgba(40, 167, 69, 0.1)'; 
                ctx.fillRect(xAxis.left, topY, xAxis.right - xAxis.left, bottomY - topY); ctx.restore();
            }
        };
        analysisTiltChart = new Chart(document.getElementById('analysis-tilt-chart'), {
            type: 'line', plugins: [tiltBgPlugin],
            data: { datasets: [{ label: '体幹前傾角(°)', data: [], borderColor: '#17a2b8', borderWidth: 1.5, pointRadius: 0, tension: 0.2 }] },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { x: { type: 'time', time: { unit: 'minute'}, ticks:{font:{size:8}, padding:2} }, y: { min: -10, max: 30, ticks:{font:{size:8}, padding:2} } }, plugins: { legend: { labels: {font:{size:8}, boxWidth:8, padding:4} } } }
        });

        analysisCorrelationChart = new Chart(document.getElementById('analysis-correlation-chart'), {
            type: 'scatter',
            data: { datasets: [
                { label: 'Steps', data: [], backgroundColor: 'rgba(40, 167, 69, 0.5)', pointRadius: 2 },
                { label: '傾向(回帰線)', data: [], type: 'line', borderColor: '#ffffff', borderWidth: 2, pointRadius: 0, borderDash: [5, 5] }
            ] },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, scales: { x: { title: { display: true, text: 'ピッチ(spm)', font:{size:8}, padding:0 }, ticks:{font:{size:8}, padding:2} }, y: { title: { display: true, text: '着地衝撃(G)', font:{size:8}, padding:0 }, min: 0, ticks:{font:{size:8}, padding:2} } }, plugins: { legend: { display: false } } }
        });

        analysisBalanceChart = new Chart(document.getElementById('analysis-balance-chart'), {
            type: 'bar',
            data: { labels: ['平均ブレ幅(°)'], datasets: [
                { label: '左下がり', data: [0], backgroundColor: '#1976d2' },
                { label: '右下がり', data: [0], backgroundColor: colorBad }
            ]},
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 15, ticks:{font:{size:8}, padding:2} }, y: { ticks:{font:{size:8}, padding:2} } }, plugins: { legend: { labels: {font:{size:8}, boxWidth:8, padding:4} } } }
        });

        analysisPieChart = new Chart(document.getElementById('analysis-pie-chart'), {
            type: 'doughnut',
            plugins: [pieTextPlugin],
            data: { labels: ['Good', 'Warn', 'Bad'], datasets: [{ data: [0,0,0], backgroundColor: [colorGood, colorWarn, colorBad], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, layout: { padding: 0 }, plugins: { legend: { display: false }, tooltip: {enabled: false} }, cutout: '40%' }
        });
    }

    function getStatus(val, min, max, warnMargin) {
        if (val >= min && val <= max) return 'good';
        if (val < min - warnMargin || val > max + warnMargin) return 'bad';
        return 'warn';
    }

    function calcRegressionLine(data) {
        if(data.length < 2) return [];
        let sumX=0, sumY=0, sumXY=0, sumXX=0, minX=Infinity, maxX=-Infinity;
        const n = data.length;
        data.forEach(p => {
            sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
        });
        const avgX = sumX / n; const avgY = sumY / n;
        const denominator = sumXX - n * avgX * avgX;
        if(denominator === 0) return [];
        const slope = (sumXY - n * avgX * avgY) / denominator;
        const intercept = avgY - slope * avgX;
        return [{x: minX, y: slope * minX + intercept}, {x: maxX, y: slope * maxX + intercept}];
    }

    function calcCorrelation(data) {
        if(data.length < 2) return 0;
        let sumX=0, sumY=0, sumXY=0, sumX2=0, sumY2=0;
        const n = data.length;
        data.forEach(p => { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x; sumY2 += p.y * p.y; });
        const num = n * sumXY - sumX * sumY;
        const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        if(den === 0) return 0;
        return num / den;
    }

    window.onRawDataReceived = function(value) {
        const newBytes = new Uint8Array(value.buffer);
        for (const byte of newBytes) {
            dataBuffer.push(byte);
            while (dataBuffer.length >= 2 && (dataBuffer[0] !== 0x55 || dataBuffer[1] !== 0x61)) { dataBuffer.shift(); }
            if (dataBuffer.length >= 20) { parseAndProcessData(dataBuffer.splice(0, 20).slice(2)); }
        }
    };

    function parseAndProcessData(bytes) {
        const dataView = new DataView(new Uint8Array(bytes).buffer);
        const data = {
            AccX: dataView.getInt16(0, true) / 32768 * 16, AccY: dataView.getInt16(2, true) / 32768 * 16, AccZ: dataView.getInt16(4, true) / 32768 * 16,
            AsX: dataView.getInt16(6, true) / 32768 * 2000, AsY: dataView.getInt16(8, true) / 32768 * 2000, AsZ: dataView.getInt16(10, true) / 32768 * 2000,
            AngX: dataView.getInt16(12, true) / 32768 * 180, AngY: dataView.getInt16(14, true) / 32768 * 180, AngZ: dataView.getInt16(16, true) / 32768 * 180,
        };

        if (typeof window.recordRawData === 'function') window.recordRawData(data);

        if (isCalibrating) {
            calibSamples.push(data);
            if (calibSamples.length >= 100) { 
                offsetAngX = calibSamples.reduce((s, d) => s + d.AngX, 0) / 100;
                offsetAngY = calibSamples.reduce((s, d) => s + d.AngY, 0) / 100;
                offsetAngZ = calibSamples.reduce((s, d) => s + d.AngZ, 0) / 100;
                isCalibrating = false;
                window.logMessage("補正完了: センサーの水平を調整しました");
            }
            return;
        }

        data.AngX -= offsetAngX; data.AngY -= offsetAngY; data.AngZ -= offsetAngZ;
        data.AngX = -data.AngX; 

        if (typeof window.updateLiveDataUI === 'function') window.updateLiveDataUI(data);
        if (!isRunning) return;
        
        processStepDetection(data);
    }

    function processStepDetection(data) {
        const now = Date.now();
        const dynamicG = Math.abs(Math.sqrt(data.AccX**2 + data.AccY**2 + data.AccZ**2) - 1.0);
        
        const stepThreshold = parseFloat(document.getElementById('stepThresholdSlider').value) || 1.5;
        const cooldownMsVal = parseInt(document.getElementById('cooldownSlider').value) || 250;

        if (now - lastStepTime < cooldownMsVal) return;

        if (!isStepping) {
            if (dynamicG > stepThreshold) { isStepping = true; peakTotalAcc = dynamicG; peakAngX = data.AngX; peakAngY = data.AngY; }
        } else {
            if (dynamicG > peakTotalAcc) { peakTotalAcc = dynamicG; peakAngX = data.AngX; peakAngY = data.AngY; }
            const settleThreshold = Math.min(stepThreshold * 0.6, 1.0);
            if (dynamicG < settleThreshold) {
                if (peakTotalAcc > 0) {
                    dropHistory.push(peakAngY);
                    if (dropHistory.length > 10) dropHistory.shift(); 
                    const dropAvg = dropHistory.reduce((a, b) => a + b, 0) / dropHistory.length;
                    const adjustedDrop = dropHistory.length >= 2 ? peakAngY - dropAvg : peakAngY;

                    const stepData = { id: now, time: new Date(now).toLocaleTimeString('it-IT'), acc: peakTotalAcc, tilt: peakAngX, drop: adjustedDrop };
                    triggerStepSuccess(stepData);
                    lastStepTime = now;
                }
                isStepping = false; 
            }
        }
    }
    
    function updatePitch() {
        const now = Date.now();
        while (pitchTimestamps.length > 0 && pitchTimestamps[0] < now - 10000) { pitchTimestamps.shift(); }
        currentPitch = pitchTimestamps.length * 6;
        
        const pitchMin = parseFloat(document.getElementById('pitchMin').value) || 170;
        const pitchMax = parseFloat(document.getElementById('pitchMax').value) || 190;

        const pitchDisplay = document.getElementById('pitchValue');
        let pStatus = 'warn';
        if (pitchDisplay) {
            pStatus = currentPitch > 0 ? getStatus(currentPitch, pitchMin, pitchMax, 10) : 'warn';
            
            // ピッチの巨大カードを更新
            const pCard = document.getElementById('card-pitch');
            if (pCard) {
                pCard.className = `metric-card ${pStatus}`;
                const valEl = pCard.querySelector('.mc-val');
                if (valEl) {
                    valEl.textContent = currentPitch > 0 ? currentPitch : '---';
                }
            }
        }
        
        if (pitchChart && currentPitch > 0) {
            const ptColor = pStatus === 'good' ? colorGood : pStatus === 'bad' ? colorBad : colorWarn;
            const chartData = pitchChart.data.datasets[0].data;
            chartData.push({x: now, y: currentPitch, color: ptColor});
            while(chartData.length > 0 && chartData[0].x < now - 5 * 60 * 1000) chartData.shift();
            pitchChart.update('quiet');
        }
    }

    function updateAdvice(stepData) {
        const now = Date.now();
        if (now - adviceTimer < 2000) return; 
        adviceTimer = now;

        let msg = "素晴らしいフォームです！キープしましょう。"; let status = "good";
        const { accStatus, tiltStatus, dropStatus, tilt } = stepData;
        
        if (accStatus === 'bad') { msg = "着地衝撃が大きすぎます。ピッチを上げましょう。"; status = "bad"; } 
        else if (dropStatus === 'bad') { msg = "骨盤の左右ブレが大きいです。体幹を真っ直ぐに。"; status = "bad"; } 
        else if (currentPitch > 0 && currentPitch < 160) { msg = "ピッチが遅めです。リズムを上げましょう。"; status = "warn"; } 
        else if (tiltStatus === 'bad') { msg = tilt < 0 ? "体が後傾しています。少し前傾を。" : "前傾しすぎています。上体を起こして。"; status = "warn"; } 
        else if (accStatus === 'warn' || dropStatus === 'warn') { msg = "フォームが少し乱れ始めています。リラックス。"; status = "warn"; }

        const adviceBox = document.getElementById('advice-box');
        if (adviceBox) { adviceBox.textContent = msg; adviceBox.className = `advice-box ${status}`; }
    }

    function triggerStepSuccess(stepData) {
        pitchTimestamps.push(stepData.id);
        stepData.pitch = currentPitch; 
        totalSteps++;
        
        const tiltMin = parseFloat(document.getElementById('tiltMin').value) || 5;
        const tiltMax = parseFloat(document.getElementById('tiltMax').value) || 15;
        const accMax = parseFloat(document.getElementById('accMax').value) || 3.0;
        const dropMax = parseFloat(document.getElementById('dropMax').value) || 5;

        stepData.accStatus = stepData.acc <= accMax ? 'good' : stepData.acc >= accMax + 1.0 ? 'bad' : 'warn';
        stepData.tiltStatus = getStatus(stepData.tilt, tiltMin, tiltMax, 5);
        stepData.dropStatus = Math.abs(stepData.drop) <= dropMax ? 'good' : Math.abs(stepData.drop) >= dropMax + 5 ? 'bad' : 'warn';

        allStepsData.push(stepData); 

        updateVisualization(stepData);
        updateAdvice(stepData); 
        addHistory(stepData);
        
        if(typeof window.recordSwingData === 'function') window.recordSwingData(stepData);

        const pStatus = document.getElementById('card-pitch').className.includes('good') ? 'good' : document.getElementById('card-pitch').className.includes('bad') ? 'bad' : 'warn';
        statsCount.pitch[pStatus]++;
        pitchPie.data.datasets[0].data = [statsCount.pitch.good, statsCount.pitch.warn, statsCount.pitch.bad];
        pitchPie.update('none');

        const distColor = (stepData.accStatus === 'good' && stepData.tiltStatus === 'good') ? colorGood : (stepData.accStatus === 'bad' || stepData.tiltStatus === 'bad') ? colorBad : colorWarn;
        const fStatus = (stepData.accStatus === 'good' && stepData.tiltStatus === 'good') ? 'good' : (stepData.accStatus === 'bad' || stepData.tiltStatus === 'bad') ? 'bad' : 'warn';
        statsCount.form[fStatus]++;
        distPie.data.datasets[0].data = [statsCount.form.good, statsCount.form.warn, statsCount.form.bad];
        distPie.update('none');

        statsCount.drop[stepData.dropStatus]++;
        dropPie.data.datasets[0].data = [statsCount.drop.good, statsCount.drop.warn, statsCount.drop.bad];
        dropPie.update('none');

        const distData = distributionChart.data.datasets[0].data;
        distData.push({ x: stepData.tilt, y: stepData.acc, bgColor: distColor });
        if (distData.length > 500) distData.shift();
        distributionChart.update('none');

        const dLabels = dropChart.data.labels;
        const dLeft = dropChart.data.datasets[0].data;
        const dRight = dropChart.data.datasets[1].data;
        dLabels.push('');
        if (stepData.drop < 0) { dLeft.push(Math.abs(stepData.drop)); dRight.push(null); } 
        else { dLeft.push(null); dRight.push(Math.abs(stepData.drop)); }
        if (dLabels.length > 50) { dLabels.shift(); dLeft.shift(); dRight.shift(); }
        dropChart.update('none');
    }
    
    function updateVisualization(stepData) {
        const { acc, tilt, drop, accStatus, tiltStatus, dropStatus } = stepData;
        
        // 生検知画面の巨大カード更新
        const accCard = document.getElementById('card-acc');
        if (accCard) {
            accCard.className = `metric-card ${accStatus}`;
            const valEl = accCard.querySelector('.mc-val');
            if (valEl) valEl.textContent = acc.toFixed(2);
        }
        
        const tiltCard = document.getElementById('card-tilt');
        if (tiltCard) {
            tiltCard.className = `metric-card ${tiltStatus}`;
            const valEl = tiltCard.querySelector('.mc-val');
            if (valEl) valEl.textContent = tilt.toFixed(1);
        }

        const dropCard = document.getElementById('card-drop');
        if (dropCard) {
            dropCard.className = `metric-card ${dropStatus}`;
            const valEl = dropCard.querySelector('.mc-val');
            if (valEl) valEl.textContent = `${Math.abs(drop).toFixed(1)} ${drop>0?'R':'L'}`;
        }

        const weight = parseFloat(document.getElementById('weightInput').value) || 72;
        const stride = parseFloat(document.getElementById('strideInput').value) || 0.8;
        
        totalDistance += (stride / 1000);
        totalKcal += weight * (stride / 1000) * 1.036;
        
        document.getElementById('stepCountValue').textContent = `${totalSteps} / ${totalDistance.toFixed(2)}km`;
        const calEl = document.getElementById('calorieValue');
        if (calEl) calEl.textContent = `${totalKcal.toFixed(1)} kcal`;
    }

    function addHistory(stepData) {
        const historyList = document.getElementById('history-list');
        const item = document.createElement('div');
        item.className = 'history-item step';
        item.innerHTML = `<span>${stepData.time}</span><span class="val-${stepData.accStatus}">${stepData.acc.toFixed(2)}g</span><span class="val-${stepData.tiltStatus}">${stepData.tilt.toFixed(1)}°</span><span class="val-${stepData.dropStatus}">${Math.abs(stepData.drop).toFixed(1)}°${stepData.drop>0?'(R)':'(L)'}</span>`;
        historyList.prepend(item);
        if (historyList.children.length > 100) historyList.lastChild.remove();
    }
    
    window.updateAnalysisView = function() {
        if (allStepsData.length === 0) {
            document.getElementById('analysis-text').innerText = "データがありません。開始してください。";
            document.getElementById('analysis-stats').innerHTML = "";
            return;
        }

        let totalScore = 0;
        let leftDropSum = 0, leftDropCount = 0;
        let rightDropSum = 0, rightDropCount = 0;
        let pitchSum = 0, pitchCount = 0;
        let accSum = 0, tiltSum = 0;
        let gCount = 0, wCount = 0, bCount = 0;
        
        let minP=Infinity, maxP=0, minA=Infinity, maxA=0, minT=Infinity, maxT=-Infinity;

        const tDataPitch = [];
        const tDataImpact = [];
        const tDataTilt = [];
        const tDataCorrelation = [];

        allStepsData.forEach(s => {
            let pts = 0;
            if (s.accStatus === 'good') pts += 33; else if (s.accStatus === 'warn') pts += 16;
            if (s.tiltStatus === 'good') pts += 33; else if (s.tiltStatus === 'warn') pts += 16;
            if (s.dropStatus === 'good') pts += 34; else if (s.dropStatus === 'warn') pts += 17;
            totalScore += pts;

            if (s.accStatus === 'bad' || s.tiltStatus === 'bad' || s.dropStatus === 'bad') bCount++;
            else if (s.accStatus === 'warn' || s.tiltStatus === 'warn' || s.dropStatus === 'warn') wCount++;
            else gCount++;

            if (s.drop < 0) { leftDropSum += Math.abs(s.drop); leftDropCount++; }
            else { rightDropSum += Math.abs(s.drop); rightDropCount++; }

            accSum += s.acc;
            if(s.acc < minA) minA = s.acc; if(s.acc > maxA) maxA = s.acc;
            
            tiltSum += s.tilt;
            if(s.tilt < minT) minT = s.tilt; if(s.tilt > maxT) maxT = s.tilt;
            
            if(s.pitch > 0) {
                pitchSum += s.pitch; pitchCount++;
                if(s.pitch < minP) minP = s.pitch; if(s.pitch > maxP) maxP = s.pitch;
                tDataPitch.push({x: s.id, y: s.pitch});
                tDataCorrelation.push({x: s.pitch, y: s.acc});
            }
            
            tDataImpact.push({x: s.id, y: s.acc});
            tDataTilt.push({x: s.id, y: s.tilt});
        });

        const avgScore = Math.round(totalScore / allStepsData.length);
        document.getElementById('analysis-score').textContent = avgScore;
        
        const avgLeft = leftDropCount > 0 ? (leftDropSum / leftDropCount).toFixed(1) : 0;
        const avgRight = rightDropCount > 0 ? (rightDropSum / rightDropCount).toFixed(1) : 0;
        const avgPitch = pitchCount > 0 ? Math.round(pitchSum / pitchCount) : 0;
        const avgAcc = (accSum / allStepsData.length).toFixed(2);
        const avgTilt = (tiltSum / allStepsData.length).toFixed(1);
        
        if(minP === Infinity) { minP = 0; maxP = 0; }
        if(minA === Infinity) { minA = 0; maxA = 0; }
        if(minT === Infinity) { minT = 0; maxT = 0; }

        // テーブル形式のバッジ
        const statsHtml = `
            <table class="analysis-table">
                <thead><tr><th>項目</th><th>平均</th><th>最小</th><th>最大</th></tr></thead>
                <tbody>
                    <tr><td>ピッチ (spm)</td><td>${avgPitch}</td><td>${minP}</td><td>${maxP}</td></tr>
                    <tr><td>衝撃 (G)</td><td>${avgAcc}</td><td>${minA.toFixed(1)}</td><td>${maxA.toFixed(1)}</td></tr>
                    <tr><td>前傾角 (°)</td><td>${avgTilt}</td><td>${minT.toFixed(0)}</td><td>${maxT.toFixed(0)}</td></tr>
                </tbody>
            </table>
        `;
        document.getElementById('analysis-stats').innerHTML = statsHtml;

        // ★高度なデータ分析テキスト生成★
        let text = `【データから読み解く詳細フォーム分析】\n`;
        
        const half = Math.floor(allStepsData.length / 2);
        if (half > 10) {
            const tilt1 = allStepsData.slice(0, half).reduce((s,d)=>s+d.tilt,0)/half;
            const tilt2 = allStepsData.slice(half).reduce((s,d)=>s+d.tilt,0)/half;
            const pitch1 = allStepsData.slice(0, half).reduce((s,d)=>s+d.pitch,0)/half;
            const pitch2 = allStepsData.slice(half).reduce((s,d)=>s+d.pitch,0)/half;

            text += `\n[1. 体幹の維持と疲労度]\n`;
            if (tilt1 - tilt2 > 2) {
                text += `後半にかけて前傾が平均 ${(tilt1-tilt2).toFixed(1)}° 減少しています。疲労により体が起き上がり、腰が落ちたフォームになっている可能性があります。腰が高く保たれるよう、目線を下げずに遠くを見る意識を持ちましょう。体幹トレーニングを取り入れることで後半の落ち込みを予防できます。\n`;
            } else if (tilt2 - tilt1 > 2) {
                text += `後半にかけて前傾が平均 ${(tilt2-tilt1).toFixed(1)}° 増加しています。前のめりになりすぎるとブレーキがかかり、太もも前側への負担が増加します。胸を張り、重心の真下で着地するよう心掛けてください。\n`;
            } else {
                text += `前後半で前傾姿勢が安定してキープされています（変動 ${(Math.abs(tilt1-tilt2)).toFixed(1)}°）。素晴らしい体幹の強さであり、長距離でも効率的な走りが期待できます。\n`;
            }

            if(pitch1 - pitch2 > 3) {
                 text += `また、後半でピッチが ${(pitch1-pitch2).toFixed(0)} spm 低下しています。足の回転が遅れると接地時間が延び、着地衝撃が増加する原因になります。疲れた時こそ腕振りを意識し、リズムを保つよう工夫しましょう。\n`;
            }
        }

        const r = calcCorrelation(tDataCorrelation);
        text += `\n[2. ピッチと着地衝撃の相関 (R=${r.toFixed(2)})]\n`;
        if (r <= -0.3) {
            text += `ピッチと衝撃に良い「負の相関」が見られます。ピッチを上げることで、一歩あたりの着地衝撃を効果的に分散・軽減できています。この調子で、ペースを上げたい時はストライドを無理に伸ばすのではなく、ピッチの回転数でコントロールする意識を続けましょう。\n`;
        } else if (r >= 0.3) {
            text += `ピッチが上がると着地衝撃も大きくなる傾向にあります。ペースを上げる際に上に跳ねるような走り（上下動の増加）や、力任せに地面を蹴っている可能性があります。着地は柔らかく、地面を「押す」のではなく「転がす」イメージを持ちましょう。\n`;
        } else {
            text += `ピッチの変動に対する着地衝撃の変化が少ない状態です。安定した足運びができていると言えますが、もし衝撃値自体が高い(2.5G以上など)場合は、シューズのクッション性を見直すか、足裏全体でフラットに接地する意識を持つと改善されます。\n`;
        }

        text += `\n[3. 骨盤の左右バランスと着地特性]\n`;
        const diff = Math.abs(avgLeft - avgRight);
        if (diff > 1.5) {
            const heavySide = avgLeft > avgRight ? '右足' : '左足';
            const weakSide = avgLeft > avgRight ? '左' : '右';
            text += `${heavySide}着地時の沈み込みが ${diff.toFixed(1)}° 大きくなっています。骨盤を支える筋力に左右差があるか、片足に体重を乗せすぎるクセがあります。この状態が続くと${heavySide}の膝や腰に故障のリスクが高まります。普段の生活で${weakSide}側の筋力強化を意識し、左右均等に体重を乗せる感覚を養いましょう。\n`;
        } else {
            text += `左右の沈み込みバランスは非常に良好（左右差 ${diff.toFixed(1)}°）です。両足で均等に衝撃を吸収できており、故障しにくい理想的なフォームと言えます。\n`;
        }

        text += `\n[4. 総合的な改善ポイント]\n`;
        if (avgScore >= 80) text += "総じて、ランニングエコノミーが非常に高く、ケガのリスクも低い理想的な走りです。現在のフォームを体に覚え込ませてください。";
        else if (avgScore >= 60) text += "全体的にまとまっていますが、一部の指標に負担が集中しています。上記の改善ポイントを1回のランニングにつき1つずつ意識して修正していきましょう。";
        else text += "着地衝撃やバランスの崩れが大きく、ケガのリスクが高い状態です。まずはスピードを落とし、ピッチを180前後に保ちながら、体の真下で優しく着地するフォーム作りに専念することをお勧めします。";

        document.getElementById('analysis-text').innerText = text;

        analysisTimelineChart.data.datasets[0].data = tDataPitch;
        analysisTimelineChart.data.datasets[1].data = tDataImpact;
        analysisTimelineChart.update('none');

        analysisTiltChart.data.datasets[0].data = tDataTilt;
        analysisTiltChart.update('none');

        const regLine = calcRegressionLine(tDataCorrelation);
        analysisCorrelationChart.data.datasets[0].data = tDataCorrelation;
        analysisCorrelationChart.data.datasets[1].data = regLine;
        analysisCorrelationChart.update('none');

        analysisBalanceChart.data.datasets[0].data = [avgLeft];
        analysisBalanceChart.data.datasets[1].data = [avgRight];
        analysisBalanceChart.update('none');

        analysisPieChart.data.datasets[0].data = [gCount, wCount, bCount];
        analysisPieChart.update('none');
    };

    window.clearHistory = function() {
        document.getElementById('history-list').innerHTML = '';
        if(pitchChart) pitchChart.data.datasets[0].data = [];
        if(distributionChart) distributionChart.data.datasets[0].data = [];
        if(dropChart) { dropChart.data.labels = []; dropChart.data.datasets[0].data = []; dropChart.data.datasets[1].data = []; }
        pitchChart.update(); distributionChart.update(); dropChart.update();
        
        totalKcal = 0.0; totalSteps = 0; totalDistance = 0.0; dropHistory = []; currentPitch = 0; allStepsData = [];
        document.getElementById('stepCountValue').textContent = `0 歩 / 0.00 km`;
        document.getElementById('calorieValue').textContent = `0.0 kcal`;
        document.getElementById('advice-box').textContent = "開始ボタンを押してスタート";
        document.getElementById('advice-box').className = "advice-box";
        
        // カードの初期化
        ['card-pitch','card-acc','card-tilt','card-drop'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.className = 'metric-card';
        });
        const vPitch = document.getElementById('pitchValue'); if(vPitch) vPitch.textContent = '---';
        const vAcc = document.getElementById('peakAccValue'); if(vAcc) vAcc.textContent = '0.00';
        const vTilt = document.getElementById('tiltValue'); if(vTilt) vTilt.textContent = '0.0';
        const vDrop = document.getElementById('dropValue'); if(vDrop) vDrop.textContent = '0.0';
        
        ['pitch', 'form', 'drop'].forEach(k => { statsCount[k] = {good:0, warn:0, bad:0}; });
        pitchPie.data.datasets[0].data = [0,0,0]; pitchPie.update();
        distPie.data.datasets[0].data = [0,0,0]; distPie.update();
        dropPie.data.datasets[0].data = [0,0,0]; dropPie.update();
        
        updateAnalysisView();
    };
})();
