const serviceUuid = "0000ffe5-0000-1000-8000-00805f9a34fb";
const characteristicUuid = "0000ffe4-0000-1000-8000-00805f9a34fb";
let bleDevice = null;
let bleCharacteristic = null;
let isRecording = false;
let rawDataLog = [];
let stepDataLog = [];

function logMessage(msg) {
    document.getElementById('log-line').textContent = msg;
}
window.logMessage = logMessage;

document.getElementById('theme-toggle').addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });

document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        logMessage("デバイス検索中...");
        bleDevice = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "WT" }], optionalServices: [serviceUuid] });
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
        logMessage("接続処理中...");
        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(serviceUuid);
        bleCharacteristic = await service.getCharacteristic(characteristicUuid);
        await bleCharacteristic.startNotifications();
        bleCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
            if (typeof window.onRawDataReceived === 'function') window.onRawDataReceived(event.target.value);
        });
        document.getElementById('statusText').textContent = "接続済";
        document.getElementById('statusText').style.borderColor = "var(--color-good)";
        logMessage("接続完了。腰に装着し、「開始」を押してください。");
    } catch (error) { logMessage("接続失敗: " + error); }
});

document.getElementById('disconnectBtn').addEventListener('click', () => { if (bleDevice && bleDevice.gatt.connected) bleDevice.gatt.disconnect(); });

function onDisconnected() {
    document.getElementById('statusText').textContent = "未接続";
    document.getElementById('statusText').style.borderColor = "var(--border-color)";
    logMessage("デバイスが切断されました。");
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => { if(typeof window.clearHistory === 'function') window.clearHistory(); });

document.getElementById('toggleTopPanelBtn').addEventListener('click', (e) => {
    const topPanel = document.getElementById('top-panel');
    if (topPanel.style.display === 'none') {
        topPanel.style.display = 'flex'; 
        e.target.textContent = 'ヘッダー隠す ▲';
    } else {
        topPanel.style.display = 'none';
        e.target.textContent = 'ヘッダー表示 ▼';
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
});

window.updateLiveDataUI = function(data) {
    const container = document.getElementById('live-data-container');
    const keys = ['AccX', 'AccY', 'AccZ', 'AsX', 'AsY', 'AsZ', 'AngX', 'AngY', 'AngZ'];
    if (container.children.length === 0 || container.innerHTML.includes('待機中')) {
        container.innerHTML = '';
        keys.forEach(key => {
            const item = document.createElement('div');
            item.className = 'data-item';
            item.id = `live-${key}`;
            item.innerHTML = `<div class="data-text-row"><span>${key}</span><span class="val">0.00</span></div><div class="bi-directional-bar"><div style="width: 50%;"><div class="bar-negative"></div></div><div style="width: 50%;"><div class="bar-positive"></div></div></div>`;
            container.appendChild(item);
        });
    }
    keys.forEach(key => {
        const el = document.getElementById(`live-${key}`);
        if (el) {
            const val = data[key];
            el.querySelector('.val').textContent = val.toFixed(2);
            const maxVal = key.includes('Acc') ? 4 : (key.includes('As') ? 500 : 90);
            const pct = Math.min(Math.abs(val) / maxVal * 100, 100);
            if (val < 0) { el.querySelector('.bar-negative').style.width = `${pct}%`; el.querySelector('.bar-positive').style.width = '0%'; } 
            else { el.querySelector('.bar-positive').style.width = `${pct}%`; el.querySelector('.bar-negative').style.width = '0%'; }
        }
    });
}

document.getElementById('recordBtn').addEventListener('click', (e) => {
    const btn = e.target;
    if (!isRecording) {
        isRecording = true;
        rawDataLog = ["Timestamp,AccX,AccY,AccZ,AsX,AsY,AsZ,AngX(Inverted),AngY,AngZ"];
        stepDataLog = ["ID_Timestamp,Time,ImpactG,ForwardTilt,PelvicDrop"];
        btn.textContent = "停止"; btn.classList.add('recording');
        logMessage("全データの記録を開始しました。");
    } else {
        isRecording = false;
        btn.textContent = "記録"; btn.classList.remove('recording');
        logMessage("記録停止。ファイルを保存します。");
        if (rawDataLog.length > 1) downloadCSV(rawDataLog.join('\n'), `running_raw_${Date.now()}.csv`);
        if (stepDataLog.length > 1) downloadCSV(stepDataLog.join('\n'), `running_steps_${Date.now()}.csv`);
    }
});

window.recordRawData = function(data) {
    if (isRecording) rawDataLog.push(`${Date.now()},${data.AccX.toFixed(3)},${data.AccY.toFixed(3)},${data.AccZ.toFixed(3)},${data.AsX.toFixed(1)},${data.AsY.toFixed(1)},${data.AsZ.toFixed(1)},${data.AngX.toFixed(2)},${data.AngY.toFixed(2)},${data.AngZ.toFixed(2)}`);
}

window.recordSwingData = function(stepData) {
    if (isRecording) stepDataLog.push(`${stepData.id},${stepData.time},${stepData.acc.toFixed(3)},${stepData.tilt.toFixed(2)},${stepData.drop.toFixed(2)}`);
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.style.display = 'none';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
