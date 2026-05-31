document.addEventListener('DOMContentLoaded', () => {
    let device = null, notifyCharacteristic = null;
    let fileHandle = null, writer = null;
    let isRecording = false;
    let recordedRows = []; // Android等、ストリームが使えない環境用のデータバッファ

    // UUID定義
    const SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
    const NOTIFY_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";

    // 安全なDOM取得（キャッシュズレによるクラッシュ防止）
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
        if(logLine) logLine.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        console.log(message);
    };

    if(themeToggle) themeToggle.addEventListener('click', () => document.body.classList.toggle('dark-mode'));

    // --- BLE 接続・切断 ---
    if(connectBtn) connectBtn.addEventListener('click', async () => {
        log("接続ボタン押下...");
        if (!navigator.bluetooth) {
            log("エラー: このブラウザはBluetoothをサポートしていません。");
            return;
        }
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
            
            if(statusText) statusText.textContent = "接続完了";
            log("接続成功！");
        } catch(error) {
            log(`エラー: ${error.message}`);
            if (device && device.gatt) device.gatt.disconnect();
        }
    });

    if(disconnectBtn) disconnectBtn.addEventListener('click', async () => {
        if (device && device.gatt.connected) {
            device.gatt.disconnect();
        } else {
            log("切断済み。");
        }
        if (isRecording) await stopRecording();
    });

    function onDisconnected() {
        log("接続が切れました。");
        if(statusText) statusText.textContent = "未接続";
        if(notifyCharacteristic) {
            notifyCharacteristic.removeEventListener('characteristicvaluechanged', onDataReceivedInternal);
        }
    }

    // --- データ記録 (PC/Android両対応) ---
    if(recordBtn) recordBtn.addEventListener('click', async () => {
        if (isRecording) await stopRecording();
        else await startRecording();
    });

    async function startRecording() {
        recordedRows = ['time,type,accuracy,tilt,orbit_points'];
        isRecording = true;
        if(recordBtn) {
            recordBtn.textContent = "記録終了";
            recordBtn.style.background = 'var(--record-color)';
        }
        log("記録開始");
    }

    async function stopRecording() {
        isRecording = false; // まず記録を止める
        if(recordBtn) {
            recordBtn.textContent = "記録開始";
            recordBtn.style.background = '';
        }

        // ★原因①対策: 最後のデータが配列に入るのを待つための僅かな遅延
        setTimeout(() => {
            if (recordedRows.length <= 1) {
                log("記録データがありませんでした。");
                recordedRows = [];
                return;
            }

            try {
                const csvContent = recordedRows.join('\n') + '\n';
                // BOM付きでBlobを生成
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
                
                const link = document.createElement('a');
                const now = new Date();
                const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                
                link.href = URL.createObjectURL(blob);
                link.download = `swing_log_${timestamp}.csv`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                log("記録データをダウンロードフォルダに保存しました。");
            } catch (e) {
                log(`保存エラー: ${e.message}`);
            }
            // バッファをクリア
            recordedRows = [];
        }, 500); // 500ミリ秒待機
    }

    window.recordSwingData = (data) => {
        if (!isRecording) return;
        const csvRow = `${data.time},${data.type},${data.acc.toFixed(4)},${data.tilt.toFixed(4)},"${data.orbitPoints.join(' ')}"`;
        recordedRows.push(csvRow);
    };

    // --- CSV読み込み (PC/Android両対応) ---
    if(loadCsvBtn) loadCsvBtn.addEventListener('click', () => {
        // Android/PC問わず、input[type=file]に統一
        const input = document.createElement('input');
        input.type = 'file';
        // ★原因②対策: accept属性を削除し、すべてのファイルを選択可能にする
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = e => {
            const file = e.target.files[0];
            if (document.body.contains(input)) document.body.removeChild(input);
            if (!file) return;

            // プログラム側で拡張子をチェック
            if (!file.name.toLowerCase().endsWith('.csv')) {
                log('エラー: .csv 形式のファイルを選択してください。');
                return;
            }
            
            const reader = new FileReader();
            reader.onload = event => {
                parseAndLoadCsv(event.target.result, file.name);
            };
            reader.readAsText(file, 'UTF-8');
        };
        
        // ファイル選択がキャンセルされた場合の後始末
        window.addEventListener('focus', () => {
            setTimeout(() => {
                if (document.body.contains(input)) {
                    document.body.removeChild(input);
                }
            }, 1000);
        }, { once: true });

        input.click();
    });

    function parseAndLoadCsv(contents, fileName) {
        if(typeof window.clearHistory === 'function') window.clearHistory();

        const rows = contents.split('\n').filter(row => row.trim() !== '' && !row.startsWith('time'));
        if (rows.length === 0) {
            log('CSVにデータがありません。');
            return;
        }

        const loadedDataForChart = [];
        const today = new Date();

        rows.forEach((row, index) => {
            const columns = row.split(',');
            if (columns.length < 4) return;
            
            const timeParts = columns[0].split(':');
            if (timeParts.length >= 3) {
                today.setHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), parseInt(timeParts[2], 10));
            }

            const swingData = {
                id: today.getTime() + index,
                timestamp: new Date(today.getTime()),
                time: columns[0],
                type: columns[1],
                acc: parseFloat(columns[2]),
                tilt: parseFloat(columns[3]),
                orbitPoints: columns[4] ? columns[4].replace(/"/g, '').split(' ') : []
            };
            
            if(typeof window.addHistory === 'function') window.addHistory(swingData);
            loadedDataForChart.push(swingData);
        });
        
        if(typeof window.loadHistoryToChart === 'function') window.loadHistoryToChart(loadedDataForChart);
        log(`${fileName} を読み込み、${rows.length}件の履歴を表示しました。`);
    }
    
    if(clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => {
        if (confirm('すべての履歴を削除しますか？')) {
            if(typeof window.clearHistory === 'function') window.clearHistory();
            log('履歴をすべて削除しました。');
        }
    });

    function onDataReceivedInternal(event) {
        const value = event.target.value;
        if (typeof window.onRawDataReceived === 'function') window.onRawDataReceived(value);
    }

    const liveDataNodes = {};
    window.updateLiveDataUI = function(data) {
        if (!liveDataContainer) return;
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
            if (key.startsWith('Acc')) percentage = (Math.abs(value) / 16) * 100;
            else if (key.startsWith('Ang')) percentage = (Math.abs(value) / 180) * 100;
            else if (key.startsWith('As')) percentage = (Math.abs(value) / 2000) * 100;
            
            node.bar.style.width = `${Math.min(percentage, 100)}%`;
        }
    };
});
