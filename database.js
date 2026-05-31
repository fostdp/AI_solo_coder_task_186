const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
let SQL = null;
let writeQueue = [];
let isFlushing = false;
const WRITE_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 500;

const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'simulation.db');
const walLogPath = path.join(dbDir, 'simulation.db-wal');
const walIndexPath = path.join(dbDir, 'simulation.db-shm');

async function initDatabase() {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    SQL = await initSqlJs({
        locateFile: file => `./node_modules/sql.js/dist/${file}`
    });

    if (fs.existsSync(dbPath)) {
        try {
            const fileBuffer = fs.readFileSync(dbPath);
            db = new SQL.Database(fileBuffer);
            console.log('已从磁盘加载现有数据库');
        } catch (e) {
            console.warn('数据库文件损坏，将创建新数据库:', e.message);
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
        console.log('创建新数据库');
    }

    enableWALMode();
    createTables();
    createTriggers();
    createIndexes();

    saveToDisk();

    setInterval(() => {
        if (writeQueue.length > 0 && !isFlushing) {
            flushWriteQueue();
        }
    }, FLUSH_INTERVAL_MS);

    console.log('SQLite数据库初始化完成 (WAL模式已启用)');
    console.log(' - 批量写入大小:', WRITE_BATCH_SIZE);
    console.log(' - 刷新间隔:', FLUSH_INTERVAL_MS + 'ms');
    console.log(' - 阳极效应自动标记触发器已就绪');
}

function enableWALMode() {
    try {
        db.run('PRAGMA journal_mode = WAL;');
        db.run('PRAGMA synchronous = NORMAL;');
        db.run('PRAGMA wal_autocheckpoint = 1000;');
        db.run('PRAGMA cache_size = -20000;');
        db.run('PRAGMA temp_store = MEMORY;');
        db.run('PRAGMA mmap_size = 2147483648;');
        
        const result = db.exec('PRAGMA journal_mode;');
        const mode = result[0]?.values[0]?.[0] || 'unknown';
        console.log('数据库journal_mode:', mode);
        
        console.log('WAL模式已启用，并发写入性能提升');
    } catch (e) {
        console.warn('启用WAL模式失败（sql.js可能不完全支持），使用标准模式:', e.message);
    }
}

function createTables() {
    db.run(`
        CREATE TABLE IF NOT EXISTS simulation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            current_density REAL NOT NULL,
            alumina_concentration REAL NOT NULL,
            critical_current_density REAL,
            bubble_coverage REAL,
            cell_voltage REAL,
            is_anode_effect INTEGER DEFAULT 0,
            arc_intensity REAL DEFAULT 0,
            local_current_density REAL,
            interpolar_distance REAL,
            anode_consumption REAL,
            mole_ratio REAL,
            caf2_content REAL,
            temperature REAL
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS voltage_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            current_density REAL,
            alumina_concentration REAL,
            cell_voltage REAL,
            bubble_coverage REAL,
            is_anode_effect INTEGER DEFAULT 0,
            arc_intensity REAL DEFAULT 0,
            local_current_density REAL,
            interpolar_distance REAL,
            anode_consumption REAL,
            mole_ratio REAL,
            caf2_content REAL,
            temperature REAL,
            FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS anode_effect_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER,
            snapshot_id INTEGER,
            start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            end_time DATETIME,
            start_voltage REAL,
            peak_voltage REAL,
            end_voltage REAL,
            duration_seconds REAL,
            average_arc_intensity REAL,
            average_local_current_density REAL,
            event_type TEXT DEFAULT 'normal',
            severity TEXT DEFAULT 'medium',
            FOREIGN KEY (run_id) REFERENCES simulation_runs(id),
            FOREIGN KEY (snapshot_id) REFERENCES voltage_snapshots(id)
        );
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS system_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            metric_name TEXT,
            metric_value REAL,
            run_id INTEGER,
            FOREIGN KEY (run_id) REFERENCES simulation_runs(id)
        );
    `);

    const checkColumn = db.exec(`PRAGMA table_info(voltage_snapshots)`);
    const columns = checkColumn[0]?.values?.map(row => row[1]) || [];
    
    const requiredColumns = [
        'is_anode_effect', 'arc_intensity', 'local_current_density', 
        'interpolar_distance', 'anode_consumption', 'mole_ratio', 
        'caf2_content', 'temperature'
    ];
    
    for (const col of requiredColumns) {
        if (!columns.includes(col)) {
            try {
                db.run(`ALTER TABLE voltage_snapshots ADD COLUMN ${col} REAL DEFAULT 0`);
            } catch (e) {
            }
        }
    }

    const runColumns = db.exec(`PRAGMA table_info(simulation_runs)`);
    const runColNames = runColumns[0]?.values?.map(row => row[1]) || [];
    
    const runRequiredCols = ['local_current_density', 'interpolar_distance', 'anode_consumption', 'mole_ratio', 'caf2_content', 'temperature'];
    for (const col of runRequiredCols) {
        if (!runColNames.includes(col)) {
            try {
                db.run(`ALTER TABLE simulation_runs ADD COLUMN ${col} REAL`);
            } catch (e) {
            }
        }
    }
}

function createTriggers() {
    try {
        db.run('DROP TRIGGER IF EXISTS trigger_auto_mark_anode_effect_snapshot;');
        
        db.run(`
            CREATE TRIGGER trigger_auto_mark_anode_effect_snapshot
            AFTER INSERT ON voltage_snapshots
            FOR EACH ROW
            WHEN NEW.is_anode_effect IS NULL OR NEW.is_anode_effect = 0
            BEGIN
                UPDATE voltage_snapshots 
                SET is_anode_effect = CASE 
                    WHEN NEW.cell_voltage >= 20 THEN 1
                    WHEN NEW.bubble_coverage >= 0.55 AND NEW.local_current_density >= NEW.current_density * 2.5 THEN 1
                    WHEN NEW.cell_voltage >= 8 AND NEW.alumina_concentration <= 1.5 THEN 1
                    ELSE 0 
                END
                WHERE id = NEW.id;
            END;
        `);

        db.run('DROP TRIGGER IF EXISTS trigger_auto_detect_ae_event_start;');
        
        db.run(`
            CREATE TRIGGER trigger_auto_detect_ae_event_start
            AFTER UPDATE ON voltage_snapshots
            FOR EACH ROW
            WHEN NEW.is_anode_effect = 1
            BEGIN
                INSERT INTO anode_effect_events 
                    (run_id, snapshot_id, start_time, start_voltage, event_type, severity)
                VALUES (
                    NEW.run_id,
                    NEW.id,
                    NEW.timestamp,
                    NEW.cell_voltage,
                    CASE 
                        WHEN NEW.cell_voltage > 50 THEN 'severe'
                        WHEN NEW.cell_voltage > 30 THEN 'normal'
                        ELSE 'mild'
                    END,
                    CASE 
                        WHEN NEW.cell_voltage > 50 THEN 'high'
                        WHEN NEW.cell_voltage > 30 THEN 'medium'
                        ELSE 'low'
                    END
                );
            END;
        `);

        db.run('DROP TRIGGER IF EXISTS trigger_update_ae_event_duration;');
        
        db.run(`
            CREATE TRIGGER trigger_update_ae_event_duration
            AFTER UPDATE ON voltage_snapshots
            FOR EACH ROW
            WHEN NEW.is_anode_effect = 1
            BEGIN
                UPDATE anode_effect_events 
                SET 
                    peak_voltage = CASE 
                        WHEN peak_voltage IS NULL THEN NEW.cell_voltage
                        WHEN peak_voltage < NEW.cell_voltage THEN NEW.cell_voltage
                        ELSE peak_voltage 
                    END,
                    average_arc_intensity = CASE
                        WHEN average_arc_intensity IS NULL THEN NEW.arc_intensity
                        ELSE (average_arc_intensity + NEW.arc_intensity) / 2
                    END,
                    average_local_current_density = CASE
                        WHEN average_local_current_density IS NULL THEN NEW.local_current_density
                        ELSE (average_local_current_density + NEW.local_current_density) / 2
                    END
                WHERE run_id = NEW.run_id 
                  AND end_time IS NULL;
            END;
        `);

        db.run('DROP TRIGGER IF EXISTS trigger_auto_close_ae_event;');
        
        db.run(`
            CREATE TRIGGER trigger_auto_close_ae_event
            AFTER INSERT ON voltage_snapshots
            FOR EACH ROW
            WHEN NEW.is_anode_effect = 0
            BEGIN
                UPDATE anode_effect_events 
                SET 
                    end_time = NEW.timestamp,
                    end_voltage = NEW.cell_voltage
                WHERE run_id = NEW.run_id 
                  AND end_time IS NULL;
            END;
        `);

        db.run('DROP TRIGGER IF EXISTS trigger_track_peak_voltage;');
        
        db.run(`
            CREATE TRIGGER trigger_track_peak_voltage
            AFTER UPDATE ON voltage_snapshots
            FOR EACH ROW
            WHEN NEW.is_anode_effect = 1
            BEGIN
                UPDATE anode_effect_events 
                SET peak_voltage = CASE 
                    WHEN peak_voltage IS NULL THEN NEW.cell_voltage
                    WHEN peak_voltage < NEW.cell_voltage THEN NEW.cell_voltage
                    ELSE peak_voltage 
                END
                WHERE run_id = NEW.run_id 
                  AND end_time IS NULL;
            END;
        `);

        console.log('阳极效应自动标记触发器已创建');
        console.log(' - trigger_auto_mark_anode_effect_snapshot: 自动标记AE快照');
        console.log(' - trigger_auto_detect_ae_event_start: 检测AE事件开始');
        console.log(' - trigger_update_ae_event_duration: 更新AE持续时间');
        console.log(' - trigger_auto_close_ae_event: 自动关闭AE事件');
        console.log(' - trigger_track_peak_voltage: 跟踪峰值电压');

    } catch (e) {
        console.warn('创建触发器失败:', e.message);
    }
}

function createIndexes() {
    db.run(`CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON simulation_runs(timestamp);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_runs_ae ON simulation_runs(is_anode_effect);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_run ON voltage_snapshots(run_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON voltage_snapshots(timestamp);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_ae ON voltage_snapshots(is_anode_effect);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ae_events_run ON anode_effect_events(run_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ae_events_start ON anode_effect_events(start_time);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_ae_events_severity ON anode_effect_events(severity);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_metrics_name ON system_metrics(metric_name);`);
    
    console.log('数据库索引已创建');
}

function queueWrite(writeFunc) {
    writeQueue.push(writeFunc);
    
    if (writeQueue.length >= WRITE_BATCH_SIZE && !isFlushing) {
        flushWriteQueue();
    }
}

function flushWriteQueue() {
    if (writeQueue.length === 0 || isFlushing) return;
    
    isFlushing = true;
    
    try {
        db.run('BEGIN TRANSACTION;');
        
        const batch = writeQueue.splice(0, WRITE_BATCH_SIZE);
        batch.forEach(writeFunc => {
            try {
                writeFunc();
            } catch (e) {
                console.error('批量写入项失败:', e.message);
            }
        });
        
        db.run('COMMIT;');
        saveToDisk();
        
    } catch (e) {
        try {
            db.run('ROLLBACK;');
        } catch (rollbackErr) {
            console.error('回滚失败:', rollbackErr.message);
        }
        console.error('批量写入失败:', e.message);
    } finally {
        isFlushing = false;
    }
    
    if (writeQueue.length >= WRITE_BATCH_SIZE) {
        setImmediate(flushWriteQueue);
    }
}

function saveToDisk() {
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    } catch (e) {
        console.error('保存数据库失败:', e.message);
    }
}

function saveSimulationRun(params) {
    try {
        const writeFunc = () => {
            const stmt = db.prepare(
                `INSERT INTO simulation_runs 
                 (current_density, alumina_concentration, critical_current_density, 
                  bubble_coverage, cell_voltage, is_anode_effect, arc_intensity,
                  local_current_density, interpolar_distance, anode_consumption,
                  mole_ratio, caf2_content, temperature)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            
            stmt.bind([
                params.currentDensity,
                params.aluminaConcentration,
                params.criticalCurrentDensity,
                params.bubbleCoverage,
                params.cellVoltage,
                params.isAnodeEffect ? 1 : 0,
                params.arcIntensity || 0,
                params.localCurrentDensity || params.currentDensity,
                params.interpolarDistance || 0.045,
                params.anodeConsumption || 0,
                params.moleRatio || 2.7,
                params.caF2Content || 5.0,
                params.temperature || 960
            ]);
            
            stmt.step();
            stmt.free();
        };
        
        queueWrite(writeFunc);
        
        const result = db.exec('SELECT last_insert_rowid() as id;');
        const runId = result[0]?.values[0]?.[0] || 1;
        
        return runId;
    } catch (e) {
        console.error('保存运行记录错误:', e.message);
        throw e;
    }
}

function saveVoltageSnapshot(runId, data) {
    try {
        const writeFunc = () => {
            const stmt = db.prepare(
                `INSERT INTO voltage_snapshots 
                 (run_id, current_density, alumina_concentration, cell_voltage, bubble_coverage, 
                  is_anode_effect, arc_intensity, local_current_density, interpolar_distance,
                  anode_consumption, mole_ratio, caf2_content, temperature)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            
            stmt.bind([
                runId,
                data.currentDensity,
                data.aluminaConcentration,
                data.cellVoltage,
                data.bubbleCoverage,
                data.isAnodeEffect ? 1 : 0,
                data.arcIntensity || 0,
                data.localCurrentDensity || data.currentDensity,
                data.interpolarDistance || 0.045,
                data.anodeConsumption || 0,
                data.moleRatio || 2.7,
                data.caF2Content || 5.0,
                data.temperature || 960
            ]);
            
            stmt.step();
            stmt.free();
        };
        
        queueWrite(writeFunc);
        
        return true;
    } catch (e) {
        console.error('保存快照错误:', e.message);
        throw e;
    }
}

function getRecentRuns(limit = 50) {
    try {
        const stmt = db.prepare(
            `SELECT * FROM simulation_runs 
             ORDER BY timestamp DESC 
             LIMIT ?`
        );
        
        stmt.bind([limit]);
        
        const rows = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push(row);
        }
        
        stmt.free();
        return rows;
    } catch (e) {
        console.error('获取运行记录错误:', e.message);
        throw e;
    }
}

function getSnapshotsByRunId(runId) {
    try {
        const stmt = db.prepare(
            `SELECT * FROM voltage_snapshots 
             WHERE run_id = ? 
             ORDER BY timestamp ASC`
        );
        
        stmt.bind([runId]);
        
        const rows = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push(row);
        }
        
        stmt.free();
        return rows;
    } catch (e) {
        console.error('获取快照错误:', e.message);
        throw e;
    }
}

function getAnodeEffectStats() {
    try {
        const result = db.exec(`
            SELECT 
                COUNT(*) as total_snapshots,
                SUM(CASE WHEN is_anode_effect = 1 THEN 1 ELSE 0 END) as ae_snapshots,
                ROUND(SUM(CASE WHEN is_anode_effect = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as ae_percentage
            FROM voltage_snapshots
        `);
        
        if (result[0] && result[0].values[0]) {
            return {
                totalSnapshots: result[0].values[0][0],
                aeSnapshots: result[0].values[0][1],
                aePercentage: result[0].values[0][2]
            };
        }
        return { totalSnapshots: 0, aeSnapshots: 0, aePercentage: 0 };
    } catch (e) {
        console.error('获取效应统计错误:', e.message);
        return { totalSnapshots: 0, aeSnapshots: 0, aePercentage: 0 };
    }
}

function getAnodeEffectEvents(runId = null) {
    try {
        let sql = `SELECT * FROM anode_effect_events ORDER BY start_time DESC LIMIT 100`;
        let params = [];
        
        if (runId) {
            sql = `SELECT * FROM anode_effect_events WHERE run_id = ? ORDER BY start_time ASC`;
            params = [runId];
        }
        
        const result = db.exec(sql, params);
        const rows = [];
        
        if (result[0]) {
            const columnNames = result[0].columns;
            result[0].values.forEach(values => {
                const row = {};
                columnNames.forEach((name, i) => {
                    row[name] = values[i];
                });
                rows.push(row);
            });
        }
        
        return rows;
    } catch (e) {
        console.error('获取效应事件错误:', e.message);
        return [];
    }
}

function getDatabaseInfo() {
    try {
        const tableInfo = db.exec(`
            SELECT 
                'simulation_runs' as table_name,
                COUNT(*) as row_count 
            FROM simulation_runs
            UNION ALL
            SELECT 
                'voltage_snapshots',
                COUNT(*) 
            FROM voltage_snapshots
            UNION ALL
            SELECT 
                'anode_effect_events',
                COUNT(*) 
            FROM anode_effect_events
        `);
        
        const tables = {};
        if (tableInfo[0]) {
            tableInfo[0].values.forEach(row => {
                tables[row[0]] = row[1];
            });
        }
        
        const pragmaResults = db.exec(`
            PRAGMA journal_mode;
        `);
        
        const journalMode = pragmaResults[0]?.values[0]?.[0] || 'unknown';
        
        return {
            tables,
            journalMode,
            writeQueueSize: writeQueue.length,
            isFlushing,
            batchSize: WRITE_BATCH_SIZE,
            flushInterval: FLUSH_INTERVAL_MS
        };
    } catch (e) {
        console.error('获取数据库信息错误:', e.message);
        return { tables: {}, journalMode: 'unknown', writeQueueSize: 0 };
    }
}

module.exports = {
    initDatabase,
    saveSimulationRun,
    saveVoltageSnapshot,
    getRecentRuns,
    getSnapshotsByRunId,
    getAnodeEffectStats,
    getAnodeEffectEvents,
    getDatabaseInfo,
    flushWriteQueue
};
