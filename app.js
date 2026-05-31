document.addEventListener('DOMContentLoaded', () => {
    let device = null, notifyCharacteristic = null;
    let fileHandle = null, writer = null;
    let isRecording = false;
    let recordedRows = []; // Android等、ストリームが使えない環境用のデータバッファ

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

    // 記録開始
    async function startRecording() {
        const now = new Date();
        const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        const fileName = `swing_log_${timestamp}.csv`;

        // デスクトップ版の保存ピッカーがサポートされているか確認
        if ('showSaveFilePicker' in window) {
            try {
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
                recordBtn.style.backgroundColor = 'var(--record-color)';
                log(`記録開始: ${fileHandle.name}`);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    log(`記録開始エラー: ${err.message}`);
                } else {
                    log("ファイル保存がキャンセルされました。");
                }
            }
        } else {
            // Android等の非対応ブラウザ用の代替保存処理 (オンメモリバッファ)
            recordedRows = ['time,type,accuracy,tilt,orbit_points'];
            isRecording = true;
            recordBtn.textContent = "記録終了";
            recordBtn.style.backgroundColor = 'var(--record-color)';
            log("記録開始 (モバイル互換モード - 終了時にダウンロード保存されます)");
        }
    }

    // 記録終了・書き出し
    async function stopRecording() {
        isRecording = false;
        recordBtn.textContent = "記録開始";
        recordBtn.style.backgroundColor = '';

        if (writer) {
            // デスクトップストリームを閉じる
            await writer.close();
            writer = null;
            fileHandle = null;
            log("記録を保存・終了しました。");
        } else {
            // Android等の代替保存処理 (Blobダウンロード)
            if (recordedRows.length > 1) {
                try {
                    const csvContent = recordedRows.join('\n') + '\n';
                    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
                    
                    const link = document.createElement('a');
                    const now = new Date();
                    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                    
                    link.href = URL.createObjectURL(blob);
                    link.download = `swing_log_${timestamp}.csv`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    log("記録データを「ダウンロード」に自動保存しました。");
                } catch (e) {
                    log(`保存エラー: ${e.message}`);
                }
            } else {
                log("記録データがありません。");
            }
            recordedRows = [];
        }
    }

    window.recordSwingData = async (data) => {
        if (!isRecording) return;
        const csvRow = `${data.time},${data.type},${data.acc.toFixed(4)},${data.tilt.toFixed(4)},"${data.orbitPoints.join(' ')}"`;
        
        if (writer) {
            await writer.write(csvRow + '\n');
        } else {
            recordedRows.push(csvRow);
        }
    };

    // 履歴読み込み (Android互換対応)
    loadCsvBtn.addEventListener('click', async () => {
        // デスクトップピッカー対応
        if ('showOpenFilePicker' in window) {
            try {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{ description: 'CSVファイル', accept: { 'text/csv': ['.csv'] } }],
                    multiple: false
                });
                const file = await fileHandle.getFile();
                const contents = await file.text();
                parseAndLoadCsv(contents, file.name);
            } catch (err) {
                if (err.name !== 'AbortError') {
                    log(`CSV読込エラー: ${err.message}`);
                } else {
                    log("ファイル選択がキャンセルされました。");
                }
            }
        } else {
            // Androidなどの互換モード: 動的に通常ファイル入力要素を生成して呼び出し
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv, text/csv';
            
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = event => {
                    parseAndLoadCsv(event.target.result, file.name);
                };
                reader.readAsText(file);
            };
            input.click();
        }
    });

    // CSV解析とUI展開
    function parseAndLoadCsv(contents, fileName) {
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
            if (columns.length < 4) return;
            const timeParts = columns[0].split(':');
            if (timeParts.length >= 3) {
                today.[...](asc_slot://start-slot-9)setHours(timeParts[0], timeParts[...](asc_slot://start-slot-10), timeParts);
            }

            const swingData = {
                id: today.getTime() + index,
                timestamp: new Date(today.[...](asc_slot://start-slot-12)getTime()),
                time: columns[0],
                type: columns[...](asc_slot://start-slot-13),
                acc: parseFloat(columns[...](asc_slot://start-slot-14)),
                tilt: parseFloat(columns[...](asc_slot://start-slot-15)),
                orbitPoints: columns ? columns.replace(/"/g, '').split(' ') : []
            };
            window.addHistory(swingData);
            loadedDataForChart.push(swingData);
        });
        
        window.loadHistoryToChart(loadedDataForChart);
        log(`${fileName} を読み込み、${rows.length}件の履歴を表示しました。`);
    }
    
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
