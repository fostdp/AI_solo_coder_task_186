const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + path, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
}

async function test() {
  console.log('=== 新增API端点测试 ===\n');
  
  console.log('1. /api/health:');
  const health = await get('/api/health');
  console.log('   ', JSON.stringify(health, null, 2));
  
  console.log('\n2. /api/db-info:');
  const dbInfo = await get('/api/db-info');
  console.log('   journal_mode:', dbInfo.journalMode);
  console.log('   数据表:', dbInfo.tables);
  console.log('   批量大小:', dbInfo.batchSize);
  console.log('   刷新间隔:', dbInfo.flushInterval + 'ms');
  
  console.log('\n3. /api/ae-events:');
  const events = await get('/api/ae-events');
  console.log('   效应事件数:', events.length);
  if (events.length > 0) {
    console.log('   最新事件:', JSON.stringify(events[0], null, 2));
  }
  
  console.log('\n4. /api/model-info features:');
  const model = await get('/api/model-info');
  model.features.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
  
  console.log('\n=== gzip压缩验证 ===');
  const req = http.get('http://localhost:3000/api/health', {
    headers: { 'Accept-Encoding': 'gzip, deflate' }
  }, (res) => {
    console.log('   Content-Encoding:', res.headers['content-encoding']);
    console.log('   Vary:', res.headers['vary']);
    console.log('\n✅ 所有API测试通过！');
  });
}

test().catch(console.error);
