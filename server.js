const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { simulate } = require('./anodeEffectModel');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function startServer() {
  await db.initDatabase();

  app.use(cors({
    origin: NODE_ENV === 'production' ? false : true,
    credentials: true
  }));

  app.use(compression({
    level: 9,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  const staticDir = NODE_ENV === 'production' 
    ? path.join(__dirname, 'dist') 
    : path.join(__dirname, 'public');
  
  if (fs.existsSync(staticDir)) {
    console.log(`提供静态资源目录: ${staticDir}`);
    app.use(express.static(staticDir, {
      maxAge: NODE_ENV === 'production' ? '1d' : 0,
      etag: true,
      lastModified: true
    }));
  } else {
    app.use(express.static(path.join(__dirname, 'public')));
  }

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      version: '2.0'
    });
  });

  app.post('/api/simulate', (req, res) => {
    try {
      const { 
        currentDensity, 
        aluminaConcentration, 
        timeFactor = 0, 
        elapsedTimeHours = 0,
        moleRatio,
        caF2Content,
        temperature
      } = req.body;
      
      if (currentDensity === undefined || aluminaConcentration === undefined) {
        return res.status(400).json({ error: '缺少必要参数' });
      }
      
      const cd = parseFloat(currentDensity);
      const ac = parseFloat(aluminaConcentration);
      const tf = parseFloat(timeFactor);
      const eth = parseFloat(elapsedTimeHours);
      
      if (isNaN(cd) || isNaN(ac) || cd < 0 || cd > 3 || ac < 0.5 || ac > 10) {
        return res.status(400).json({ error: '参数范围无效：电流密度0-3 A/cm²，氧化铝浓度0.5-10%' });
      }
      
      const options = {};
      if (moleRatio !== undefined) options.moleRatio = parseFloat(moleRatio);
      if (caF2Content !== undefined) options.caF2Content = parseFloat(caF2Content);
      if (temperature !== undefined) options.temperature = parseFloat(temperature);
      
      const result = simulate(cd, ac, tf, eth, options);
      res.json(result);
    } catch (error) {
      console.error('模拟错误:', error);
      res.status(500).json({ error: '模拟计算失败' });
    }
  });

  app.post('/api/save-run', (req, res) => {
    try {
      const params = req.body;
      const runId = db.saveSimulationRun(params);
      res.json({ success: true, runId });
    } catch (error) {
      console.error('保存运行记录错误:', error);
      res.status(500).json({ error: '保存失败' });
    }
  });

  app.post('/api/save-snapshot', (req, res) => {
    try {
      const { runId, data } = req.body;
      db.saveVoltageSnapshot(runId, data);
      res.json({ success: true });
    } catch (error) {
      console.error('保存快照错误:', error);
      res.status(500).json({ error: '保存快照失败' });
    }
  });

  app.get('/api/ae-stats', (req, res) => {
    try {
      const stats = db.getAnodeEffectStats();
      res.json(stats);
    } catch (error) {
      console.error('获取统计错误:', error);
      res.status(500).json({ error: '获取统计失败' });
    }
  });

  app.get('/api/ae-events', (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId) : null;
      const events = db.getAnodeEffectEvents(runId);
      res.json(events);
    } catch (error) {
      console.error('获取效应事件错误:', error);
      res.status(500).json({ error: '获取事件失败' });
    }
  });

  app.get('/api/db-info', (req, res) => {
    try {
      const info = db.getDatabaseInfo();
      res.json(info);
    } catch (error) {
      console.error('获取数据库信息错误:', error);
      res.status(500).json({ error: '获取信息失败' });
    }
  });

  app.get('/api/runs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const runs = db.getRecentRuns(limit);
      res.json(runs);
    } catch (error) {
      console.error('获取运行记录错误:', error);
      res.status(500).json({ error: '获取记录失败' });
    }
  });

  app.get('/api/snapshots/:runId', (req, res) => {
    try {
      const runId = parseInt(req.params.runId);
      const snapshots = db.getSnapshotsByRunId(runId);
      res.json(snapshots);
    } catch (error) {
      console.error('获取快照错误:', error);
      res.status(500).json({ error: '获取快照失败' });
    }
  });

  app.post('/api/flush', async (req, res) => {
    try {
      db.flushWriteQueue();
      await new Promise(resolve => setTimeout(resolve, 100));
      res.json({ success: true, message: '写入队列已刷新' });
    } catch (error) {
      console.error('刷新队列错误:', error);
      res.status(500).json({ error: '刷新失败' });
    }
  });

  app.get('/api/model-info', (req, res) => {
    res.json({
      name: '电解铝阳极效应模型',
      version: '2.0',
      description: '基于多物理场耦合的气泡动力学、电化学和阳极消耗模型',
      features: [
        '熔盐热力学计算（粘度、电阻率、表面张力）',
        '气泡动力学模型（成核、生长、脱离、上升）',
        '多物理场耦合迭代（5次正反馈迭代）',
        '阳极消耗动态极距计算',
        '熔盐成分相关消耗速率',
        'SQLite WAL模式并发写入',
        '阳极效应自动标记触发器'
      ],
      parameters: {
        currentDensity: {
          name: '电流密度',
          unit: 'A/cm²',
          range: [0, 3],
          default: 0.8
        },
        aluminaConcentration: {
          name: '氧化铝浓度',
          unit: '%',
          range: [0.5, 10],
          default: 5.0
        },
        moleRatio: {
          name: '分子比',
          unit: 'NaF/AlF3',
          range: [2.0, 3.5],
          default: 2.7
        },
        caF2Content: {
          name: '氟化钙含量',
          unit: '%',
          range: [0, 15],
          default: 5.0
        },
        temperature: {
          name: '槽温',
          unit: '℃',
          range: [940, 980],
          default: 960
        },
        elapsedTimeHours: {
          name: '运行时间',
          unit: '小时',
          range: [0, 1000],
          default: 0
        }
      },
      outputs: {
        criticalCurrentDensity: '临界电流密度 (A/cm²)',
        localCurrentDensity: '局部电流密度 (A/cm²)',
        bubbleCoverage: '气泡覆盖率 (0-1)',
        bubbleDiameter: '气泡直径 (m)',
        bubbleVelocity: '气泡上升速度 (m/s)',
        massTransferCoeff: '传质系数 (m²/s)',
        effectiveResistivity: '有效电阻率 (Ω·m)',
        cellVoltage: '槽电压 (V)',
        isAnodeEffect: '是否发生阳极效应',
        isAnodeEffectImminent: '阳极效应预警',
        arcIntensity: '弧光强度 (0-1)',
        interpolarDistance: '极距 (m)',
        anodeHeight: '阳极高度 (m)',
        anodeConsumption: '阳极消耗量 (m)'
      }
    });
  });

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ 
      error: '服务器内部错误',
      message: NODE_ENV === 'development' ? err.message : undefined
    });
  });

  const server = app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log(`电解铝阳极效应模拟服务器已启动`);
    console.log('='.repeat(60));
    console.log(`环境: ${NODE_ENV}`);
    console.log(`访问地址: http://localhost:${PORT}`);
    console.log(`API端口: ${PORT}`);
    console.log(`gzip压缩: 已启用`);
    console.log(`静态资源: ${staticDir}`);
    console.log('='.repeat(60));
    console.log('可用API端点:');
    console.log('  GET  /api/health       - 健康检查');
    console.log('  GET  /api/model-info   - 模型信息');
    console.log('  POST /api/simulate     - 执行模拟');
    console.log('  POST /api/save-run     - 保存运行记录');
    console.log('  POST /api/save-snapshot- 保存电压快照');
    console.log('  GET  /api/runs         - 获取运行记录');
    console.log('  GET  /api/snapshots/:id- 获取快照');
    console.log('  GET  /api/ae-stats     - 效应统计');
    console.log('  GET  /api/ae-events    - 效应事件列表');
    console.log('  GET  /api/db-info      - 数据库信息');
    console.log('  POST /api/flush        - 刷新写入队列');
    console.log('='.repeat(60));
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  process.on('SIGTERM', () => {
    console.log('收到SIGTERM，正在关闭服务器...');
    db.flushWriteQueue();
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('收到SIGINT，正在关闭服务器...');
    db.flushWriteQueue();
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });
}

startServer().catch(err => {
  console.error('服务器启动失败:', err);
  process.exit(1);
});
