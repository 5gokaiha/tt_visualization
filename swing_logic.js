// --- 判定ロジック専用スコープ ---
(function() {
    let dataBuffer = [];
    let isCooldown = false;
    let isSwinging = false;
    let peakTotalAcc = 0;
    let peakAngX = 0;
    let swingOrbitPoints = [];

    // UI要素をキャッシュ
    let swingThreshold = 3.0;
    let accHighlightThreshold = 8.0;
    let angleHighlightThreshold = 45;

    // ★★★ サウンド機能関連 ★★★
    let audioCtx; // AudioContextは一度だけ生成して再利用する

    // 指定した周波数と長さでビープ音を再生する関数
    function playBeep(frequency, duration = 80) {
        try {
            // ユーザーの操作によって初めてAudioContextを初期化する（ブラウザの自動再生ポリシー対策）
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'sine'; // 滑らかなサイン波
            oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime);
            
            // 音の開始と終了を滑らかにして「プツッ」というノイズを防ぐ
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01); // 0.01秒でフェードイン
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + (duration / 1000)); // 最後に向けてフェードアウト

            oscillator.start();
            oscillator.stop(audioCtx.currentTime + (duration / 1000));
        } catch (e) {
            console.error("サウンドの再生に失敗しました:", e);
        }
    }
    
    // (DOMContentLoadedなどの既存コードは変更なし)
    document.addEventListener('DOMContentLoaded', () => {
        const swingThresholdSlider = document.getElementById('swingThresholdSlider');
        const swingThresholdVal = document.getElementById('swingThresholdVal');
        const accHighlightSlider = document.getElementById('accHighlightSlider');
        const accHighlightVal = document.getElementById('accHighlightVal');
        const angleHighlightSlider = document.getElementById('angleHighlightSlider');
        const angleHighlightVal = document.getElementById('angleHighlightVal');

        swingThreshold = parseFloat(swingThresholdSlider.value);
        accHighlightThreshold = parseFloat(accHighlightSlider.value);
        angleHighlightThreshold = parseFloat(angleHighlightSlider.value);

        swingThresholdSlider.addEventListener('input', (e) => {
            swingThreshold = parseFloat(e.target.value);
            swingThresholdVal.textContent = swingThreshold.toFixed(1);
        });
        accHighlightSlider.addEventListener('input', (e) => {
            accHighlightThreshold = parseFloat(e.target.value);
            accHighlightVal.textContent = accHighlightThreshold.toFixed(1);
        });
        angleHighlightSlider.addEventListener('input', (e) => {
            angleHighlightThreshold = parseFloat(e.target.value);
            angleHighlightVal.textContent = angleHighlightThreshold.toFixed(0);
        });
        
        initializeDistributionChart();
    });

    function initializeDistributionChart() {
        const ctx = document.getElementById('distribution-chart').getContext('2d');
        if (!ctx) return;

        distributionChart = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [
                { label: 'FH', data: [], backgroundColor: 'rgba(211, 47, 47, 0.7)' },
                { label: 'BH', data: [], backgroundColor: 'rgba(25, 118, 210, 0.7)' }
            ]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { type: 'linear', position: 'bottom', min: 0, max: 90, title: { display: true, text: 'Tilt Angle (deg)', font: { size: 10 } }, ticks: { font: { size: 10 } }, grid: { color: 'rgba(128, 128, 128, 0.2)' } },
                    y: { min: 0, max: 20, title: { display: true, text: 'Accel (g)', font: { size: 10 } }, ticks: { font: { size: 10 } }, grid: { color: 'rgba(128, 128, 128, 0.2)' } }
                },
                plugins: {
                    legend: { display: false }, 
                    tooltip: { callbacks: { label: function(context) { return `${context.dataset.label || ''}: (${context.parsed.x.toFixed(1)}°, ${context.parsed.y.toFixed(2)}g)`; } } }
                }
            }
        });
    }
    
    function updateDistributionChart(action, data) {
        if (!distributionChart) return;
        const fhData = distributionChart.data.datasets[0].data;
        const bhData = distributionChart.data.datasets[1].data;

        switch (action) {
            case 'add':
                const dataset = data.type === 'FH' ? fhData : bhData;
                dataset.push({ x: data.tilt, y: data.acc, id: data.id });
                break;
            case 'remove':
                const fhIndex = fhData.findIndex(p => p.id === data.id);
                if (fhIndex > -1) fhData.splice(fhIndex, 1);
                const bhIndex = bhData.findIndex(p => p.id === data.id);
                if (bhIndex > -1) bhData.splice(bhIndex, 1);
                break;
            case 'clear':
                fhData.length = 0;
                bhData.length = 0;
                break;
            case 'load':
                fhData.length = 0;
                bhData.length = 0;
                data.forEach(d => {
                    const targetDataset = d.type === 'FH' ? fhData : bhData;
                    targetDataset.push({ x: d.tilt, y: d.acc, id: d.id });
                });
                break;
        }
        distributionChart.update('none');
    }

    window.onRawDataReceived = function(value) {
        const newBytes = new Uint8Array(value.buffer);
        for (const byte of newBytes) {
            dataBuffer.push(byte);
            while (dataBuffer.length >= 2 && (dataBuffer[0] !== 0x55 || dataBuffer[1] !== 0x61)) {
                dataBuffer.shift();
            }
            if (dataBuffer.length >= 20) {
                const packet = dataBuffer.splice(0, 20);
                processData(packet.slice(2));
            }
        }
    };

    function processData(bytes) {
        const dataView = new DataView(new Uint8Array(bytes).buffer);
        const data = {
            AccX: dataView.getInt16(0, true) / 32768 * 16,
            AccY: dataView.getInt16(2, true) / 32768 * 16,
            AccZ: dataView.getInt16(4, true) / 32768 * 16,
            AsX:  dataView.getInt16(6, true) / 32768 * 2000,
            AsY:  dataView.getInt16(8, true) / 32768 * 2000,
            AsZ:  dataView.getInt16(10, true) / 32768 * 2000,
            AngX: dataView.getInt16(12, true) / 32768 * 180,
            AngY: dataView.getInt16(14, true) / 32768 * 180,
            AngZ: dataView.getInt16(16, true) / 32768 * 180,
        };
        processSwingData(data);
        if (typeof window.updateLiveDataUI === 'function') {
            window.updateLiveDataUI(data);
        }
    }

    function processSwingData(data) {
        const totalAcc = Math.sqrt(data.AccX**2 + data.AccY**2 + data.AccZ**2);
        
        if (isCooldown) return;
        
        if (!isSwinging) {
            if (totalAcc > swingThreshold) { 
                isSwinging = true; peakTotalAcc = totalAcc; peakAngX = data.AngX; swingOrbitPoints = []; 
            }
        } else {
            if (totalAcc > peakTotalAcc) { peakTotalAcc = totalAcc; peakAngX = data.AngX; }
            swingOrbitPoints.push(`${data.AccX.toFixed(4)},${(-data.AccY).toFixed(4)}`);

            const settleThreshold = Math.min(swingThreshold * 0.7, 1.5);
            if (totalAcc < settleThreshold) {
                if (peakTotalAcc > 0) {
                    let tiltAngle = 0, swingType = "";
                    if (peakAngX > 0) { tiltAngle = 90 - peakAngX; swingType = "FH"; } 
                    else if (peakAngX < 0) { tiltAngle = 90 - Math.abs(peakAngX); swingType = "BH"; }
                    tiltAngle = Math.max(0, Math.min(90, tiltAngle));
                    
                    if (Math.round(tiltAngle) > 0) {
                        const now = new Date();
                        const swingData = {
                            id: now.getTime(),
                            timestamp: now,
                            time: now.toLocaleTimeString('it-IT'),
                            type: swingType,
                            acc: peakTotalAcc,
                            tilt: tiltAngle,
                            orbitPoints: swingOrbitPoints
                        };
                        triggerSwingSuccess(swingData);
                        
                        if(typeof window.recordSwingData === 'function') {
                            window.recordSwingData(swingData);
                        }

                        isCooldown = true;
                        setTimeout(() => { isCooldown = false; }, 400);
                    }
                }
                isSwinging = false; peakTotalAcc = 0; peakAngX = 0;
            }
        }
    }

    // ★★★ triggerSwingSuccess でサウンドを再生 ★★★
    function triggerSwingSuccess(swingData) {
        updateVisualization(swingData);
        addHistory(swingData);
        updateDistributionChart('add', swingData);

        // FHとBHで音の高さを変える
        if (swingData.type === 'FH') {
            playBeep(880); // 高い「ラ」の音
        } else {
            playBeep(659); // 少し低い「ミ」の音
        }
    }
    
    function updateVisualization(swingData) {
        const { type, acc, tilt, orbitPoints } = swingData;
        const colorClass = type.toLowerCase();
        
        flashIndicator(colorClass);
        applyUiColor(type);
        
        document.getElementById('racket-text').textContent = type;
        document.getElementById('peakAccValue').textContent = `${acc.toFixed(2)}g`;
        document.getElementById('peakAccBar').style.width = `${Math.min(acc / 16 * 100, 100)}%`;
        
        const angleTextEl = document.getElementById('angle-text');
        const angleNeedle = document.getElementById('angle-needle');
        const angleArc = document.getElementById('angle-arc');
        
        angleTextEl.textContent = `${tilt.toFixed(0)}°`;
        angleNeedle.style.transform = `rotate(${-tilt}deg)`;

        const radius = 40;
        const angleInRad = (-tilt) * (Math.PI / 180);
        const endX_arc = 10 + radius * Math.cos(angleInRad);
        const endY_arc = 90 + radius * Math.sin(angleInRad);
        const largeArcFlag = 0;
        const pathData = tilt > 0 ? `M ${10 + radius} 90 A ${radius} ${radius} 0 ${largeArcFlag} 0 ${endX_arc} ${endY_arc}` : "";
        angleArc.setAttribute('d', pathData);

        const orbitPath = document.getElementById('orbit-path');
        orbitPath.setAttribute('points', orbitPoints.join(' '));
        orbitPath.style.stroke = `var(--color-${colorClass})`;
    }

    function applyUiColor(type) {
        const colorClass = type.toLowerCase();
        document.querySelectorAll('.text-fh, .text-bh, .bg-color-fh, .bg-color-bh, .fill-fh, .fill-bh, .stroke-fh, .stroke-bh').forEach(el => {
            el.classList.remove('text-fh', 'text-bh', 'bg-color-fh', 'bg-color-bh', 'fill-fh', 'fill-bh', 'stroke-fh', 'stroke-bh');
        });
        
        const racketVisual = document.getElementById('racket-visual');
        racketVisual.style.fill = `var(--color-${colorClass})`;

        document.getElementById('racket-text').classList.add(`text-${colorClass}`);
        document.getElementById('peakAccValue').classList.add(`text-${colorClass}`);
        document.getElementById('peakAccBar').classList.add(`bg-color-${colorClass}`);
        
        document.getElementById('angle-text').classList.add(`fill-${colorClass}`);
        document.getElementById('angle-needle').classList.add(`stroke-${colorClass}`);
        document.getElementById('angle-arc').classList.add(`stroke-${colorClass}`);
    }

    window.addHistory = function(swingData) {
        const historyList = document.getElementById('history-list');
        const item = document.createElement('div');
        item.className = `history-item ${swingData.type.toLowerCase()}`;
        item.dataset.id = swingData.id;
        
        const accHighlightClass = swingData.acc >= accHighlightThreshold ? 'highlight' : '';
        const tiltHighlightClass = swingData.tilt >= angleHighlightThreshold ? 'highlight' : '';

        item.innerHTML = `
            <span class="history-time">${swingData.time}</span>
            <span class="history-type">${swingData.type}</span>
            <span class="${accHighlightClass}">${swingData.acc.toFixed(2)}g</span>
            <span class="${tiltHighlightClass}">${swingData.tilt.toFixed(0)}°</span>
            <span class="delete-btn">×</span>
        `;
        
        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            updateDistributionChart('remove', { id: swingData.id });
            item.remove();
        });
        
        item.addEventListener('click', () => {
             updateVisualization(swingData);
        });

        historyList.prepend(item);
        if (historyList.children.length > 200) {
            const oldItem = historyList.lastChild;
            if(oldItem.dataset.id) {
                updateDistributionChart('remove', { id: parseInt(oldItem.dataset.id) });
            }
            oldItem.remove();
        }
    }
    
    window.clearHistory = function() {
        document.getElementById('history-list').innerHTML = '';
        updateDistributionChart('clear');
    };
    
    window.loadHistoryToChart = function(data) {
        updateDistributionChart('load', data);
    };

    function flashIndicator(type) {
        const elem = document.getElementById(`${type}-indicator`);
        if(elem) { 
            elem.classList.add(`${type}-active`); 
            setTimeout(() => elem.classList.remove(`${type}-active`), 500); 
        }
    }
})();
