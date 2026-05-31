document.addEventListener('DOMContentLoaded', () => {
    let device = null, notifyCharacteristic = null;
    let fileHandle = null, writer = null;
    let isRecording = false;

    // UUID定義
    const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
    const NOTIFY_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";

    // DOM要素の取得
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const recordBtn = document.getElementById('recordBtn');
    const loadCsvBtn = document.getElementById('loadCsvBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const statusText = document.getElementById('statusText');
    const logLine = document.getElementById('log-line');
    const themeToggle = document.getElementById('theme-toggle');
    const liveDataContainer = document.getElementById('live-data-container');

    window.log = function(message) {
        logLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    };

    themeToggle.addEventListener('click', () => document.body.classList.toggle('dark-mode'));

    connectBtn.addEventListener('click', async () => {
        log("接続ボタン押下...");
        try {
            log("デバイスを検索中...");
            device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'WT' }],
                optionalServices: [SERVICE_UUID]
            });
            log(`デバイス選択: ${device.name}`);
            device.addEventListener('gattserverdisconnected', onDisconnected);
            
            const server = await device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE_UUID);
            notifyCharacteristic = await service.getCharacteristic(NOTIFY_UUID);
            
            await notifyCharacteristic.startNotifications();
            notifyCharacteristic.addEventListener('characteristicvaluechanged', onDataReceivedInternal);
            
            statusText.textContent = "接続完了";
            log("接続成功！");
        } catch(error) {
            log(`エラー: ${error.message}`);
            if (device && device.gatt) device.gatt.disconnect();
        }
    });

    disconnectBtn.addEventListener('click', async () => {
        if (device && device.gatt.connected) {
            device.gatt.disconnect();
        } else {
            log("切断済み。");
        }
        if (isRecording) {
            await stopRecording();
        }
    });

    function onDisconnected() {
        log("接続が切れました。");
        statusText.textContent = "未接続";
        if(notifyCharacteristic) {
            notifyCharacteristic.removeEventListener('characteristicvaluechanged', onDataReceivedInternal);
        }
    }

    recordBtn.addEventListener('click', async () => {
        if (isRecording) {
            await stopRecording();
        } else {
            await startRecording();
        }
    });

    async function startRecording() {
        try {
            const now = new Date();
            const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
            const fileName = `swing_log_${timestamp}.csv`;

            fileHandle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: 'CSVファイル',
                    accept: { 'text/csv': ['.csv'] },
                }],
            });

            writer = await fileHandle.createWritable();
            await writer.write('time,type,accuracy,tilt,orbit_points\n');
            
            isRecording = true;
            recordBtn.textContent = "記録終了";
            recordBtn.style.backgroundColor = 'var(--record-color)'; // 記録色を適用

        } catch (err) {
            if (err.name !== 'AbortError') {
                log(`記録開始エラー: ${err.message}`);
            } else {
                log("ファイル保存がキャンセルされました。");
            }
        }
    }

    async function stopRecording() {
        if (writer) {
            await writer.close();
        }
        writer = null;
        fileHandle = null;
        isRecording = false;
        recordBtn.textContent = "記録開始";
        recordBtn.style.backgroundColor = ''; // デフォルト色に戻す
        log("記録を終了しました。");
    }

    window.recordSwingData = async (data) => {
        if (!isRecording || !writer) return;
        const csvRow = `${data.time},${data.type},${data.acc.toFixed(4)},${data.tilt.toFixed(4)},"${data.orbitPoints.join(' ')}"\n`;
        await writer.write(csvRow);
    };

    loadCsvBtn.addEventListener('click', async () => {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'CSVファイル', accept: { 'text/csv': ['.csv'] } }],
                multiple: false
            });
            const file = await fileHandle.getFile();
            const contents = await file.text();
            
            window.clearHistory();

            const rows = contents.split('\n').filter(row => row.trim() !== '' && !row.startsWith('time'));
            if (rows.length === 0) {
                log('CSVにデータがありません。');
                return;
            }

            const loadedDataForChart = [];
            const today = new Date();

            rows.forEach((row, index) => {
                const columns = row.split(',');
                const timeParts = columns[0].split(':');
                today.setHours(timeParts[0], timeParts[1], timeParts[2]);

                const swingData = {
                    id: today.getTime() + index,
                    timestamp: new Date(today.getTime()),
                    time: columns[0],
                    type: columns[1],
                    acc: parseFloat(columns[2]),
                    tilt: parseFloat(columns[3]),
                    orbitPoints: columns[4] ? columns[4].replace(/"/g, '').split(' ') : []
                };
                window.addHistory(swingData);
                loadedDataForChart.push(swingData);
            });
            
            window.loadHistoryToChart(loadedDataForChart);
            log(`${file.name} を読み込み、${rows.length}件の履歴を表示しました。`);

        } catch (err) {
            if (err.name !== 'AbortError') {
                log(`CSV読込エラー: ${err.message}`);
            } else {
                log("ファイル選択がキャンセルされました。");
            }
        }
    });
    
    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('すべての履歴を削除しますか？')) {
            window.clearHistory();
            log('履歴をすべて削除しました。');
        }
    });

    function onDataReceivedInternal(event) {
        const value = event.target.value;
        if (typeof window.onRawDataReceived === 'function') {
            window.onRawDataReceived(value);
        }
    }

    const liveDataNodes = {};
    window.updateLiveDataUI = function(data) {
        if (liveDataContainer.textContent.includes('待機中')) liveDataContainer.innerHTML = '';
        for (const key in data) {
            if (!liveDataNodes[key]) {
                const row = document.createElement('div');
                row.className = 'data-item';
                row.innerHTML = `
                    <div class="data-text-row">
                        <span>${key}:</span>
                        <span class="val-text"></span>
                    </div>
                    <div class="data-bar-container">
                        <div class="data-bar"></div>
                    </div>
                `;
                liveDataContainer.appendChild(row);
                liveDataNodes[key] = {
                    text: row.querySelector('.val-text'),
                    bar: row.querySelector('.data-bar')
                };
            }
            const node = liveDataNodes[key];
            const value = data[key];
            
            node.text.textContent = (typeof value === 'number') ? value.toFixed(2) : value;

            let percentage = 0;
            if (key.startsWith('Acc')) {
                percentage = (Math.abs(value) / 16) * 100;
            } else if (key.startsWith('Ang')) {
                percentage = (Math.abs(value) / 180) * 100;
            } else if (key.startsWith('As')) {
                percentage = (Math.abs(value) / 2000) * 100;
            }
            node.bar.style.width = `${Math.min(percentage, 100)}%`;
        }
    };
});
