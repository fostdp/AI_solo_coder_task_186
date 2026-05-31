const {
  simulate,
  calculateCriticalCurrentDensity,
  calculateBubbleCoverageWithFeedback,
  CONSTANTS
} = require('../anodeEffectModel');

const http = require('http');

let totalAssertions = 0;
let passedAssertions = 0;
let failedDetails = [];

function assert(condition, groupName, description) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  ✅ ${description}`);
  } else {
    failedDetails.push({ group: groupName, description });
    console.log(`  ❌ ${description}`);
  }
}

function assertGT(a, b, groupName, description) {
  assert(a > b, groupName, `${description} (${a.toFixed(4)} > ${b.toFixed(4)})`);
}

function assertLT(a, b, groupName, description) {
  assert(a < b, groupName, `${description} (${a.toFixed(4)} < ${b.toFixed(4)})`);
}

function assertGTE(a, b, groupName, description) {
  assert(a >= b, groupName, `${description} (${a.toFixed(4)} >= ${b.toFixed(4)})`);
}

function assertEQ(a, b, groupName, description) {
  assert(a === b, groupName, `${description} (expected=${b}, actual=${a})`);
}

function assertExists(val, groupName, description) {
  assert(val !== undefined && val !== null, groupName, `${description} (value=${val})`);
}

function assertApprox(a, b, tolerance, groupName, description) {
  const diff = Math.abs(a - b);
  assert(diff <= tolerance, groupName, `${description} (${a.toFixed(4)} ≈ ${b.toFixed(4)}, diff=${diff.toFixed(4)})`);
}

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON解析失败: ${data.substring(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runAllTests() {
  console.log('='.repeat(70));
  console.log('电解铝阳极效应模拟 — 验证测试');
  console.log('='.repeat(70));

  await testGroup1_voltageSpikeOnConcentrationDrop();
  await testGroup2_effectTriggerConcentrationShifts();
  await testGroup3_snapshotEventMarkers();

  console.log('\n' + '='.repeat(70));
  console.log(`总断言: ${totalAssertions}  通过: ${passedAssertions}  失败: ${totalAssertions - passedAssertions}`);
  console.log('='.repeat(70));

  if (failedDetails.length > 0) {
    console.log('\n❌ 失败用例明细:');
    console.log('-'.repeat(70));
    failedDetails.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.group}] ${f.description}`);
    });
    console.log('-'.repeat(70));
  } else {
    console.log('\n🎉 全部断言通过！');
  }

  process.exit(failedDetails.length > 0 ? 1 : 0);
}

async function testGroup1_voltageSpikeOnConcentrationDrop() {
  const GROUP = '测试1: 氧化铝浓度从3%降至1%时槽电压是否在临界值突升';
  console.log(`\n📋 ${GROUP}`);
  console.log('-'.repeat(60));

  const currentDensity = 0.8;
  const concentrations = [3.0, 2.5, 2.0, 1.8, 1.5, 1.2, 1.0, 0.8, 0.5];
  const results = concentrations.map(c => simulate(currentDensity, c, 0, 0));

  const normalResults = results.filter(r => !r.isAnodeEffect);
  const aeResults = results.filter(r => r.isAnodeEffect);

  assertGT(aeResults.length, 0, GROUP, '存在阳极效应触发的浓度点');

  const conc3 = results[0];
  const conc1 = results[6];

  assert(!conc3.isAnodeEffect, GROUP, `3%浓度时不应触发阳极效应 (实际=${conc3.isAnodeEffect})`);

  assertGT(conc1.cellVoltage, conc3.cellVoltage * 3, GROUP,
    `1%浓度槽电压应远高于3%浓度 (V1=${conc1.cellVoltage}V vs V3=${conc3.cellVoltage}V)`);

  assert(conc1.isAnodeEffect, GROUP, `1%浓度时应触发阳极效应 (实际=${conc1.isAnodeEffect})`);

  let spikeRatio = conc1.cellVoltage / conc3.cellVoltage;
  assertGT(spikeRatio, 4.0, GROUP,
    `电压突升比应>4倍 (实际=${spikeRatio.toFixed(1)}倍, V1=${conc1.cellVoltage}V, V3=${conc3.cellVoltage}V)`);

  let transitionFound = false;
  for (let i = 1; i < results.length; i++) {
    if (results[i].isAnodeEffect && !results[i - 1].isAnodeEffect) {
      transitionFound = true;
      const prevVoltage = results[i - 1].cellVoltage;
      const currVoltage = results[i].cellVoltage;
      const jumpRatio = currVoltage / prevVoltage;
      assertGT(jumpRatio, 2.0, GROUP,
        `浓度${concentrations[i - 1]}%→${concentrations[i]}%时电压突升比>2 (实际=${jumpRatio.toFixed(1)}倍)`);
      break;
    }
  }
  assert(transitionFound, GROUP, '存在正常→阳极效应的状态跳变点');

  const localJ_at_3pct = conc3.localCurrentDensity;
  const localJ_at_1pct = conc1.localCurrentDensity;
  assertGT(localJ_at_1pct, localJ_at_3pct, GROUP,
    `1%浓度局部电流密度应>3%浓度 (J_local@1%=${localJ_at_1pct.toFixed(3)}, J_local@3%=${localJ_at_3pct.toFixed(3)})`);

  const coverage_at_3pct = conc3.bubbleCoverage;
  const coverage_at_1pct = conc1.bubbleCoverage;
  assertGT(coverage_at_1pct, coverage_at_3pct, GROUP,
    `1%浓度气泡覆盖率应>3%浓度 (θ@1%=${(coverage_at_1pct * 100).toFixed(1)}%, θ@3%=${(coverage_at_3pct * 100).toFixed(1)}%)`);

  let maxNormalVoltage = -Infinity;
  let minAEVoltage = Infinity;
  results.forEach(r => {
    if (!r.isAnodeEffect && r.cellVoltage > maxNormalVoltage) maxNormalVoltage = r.cellVoltage;
    if (r.isAnodeEffect && r.cellVoltage < minAEVoltage) minAEVoltage = r.cellVoltage;
  });
  if (aeResults.length > 0 && normalResults.length > 0) {
    assertGT(minAEVoltage, maxNormalVoltage * 2, GROUP,
      `阳极效应最低电压应>正常最高电压2倍 (V_ae_min=${minAEVoltage}V, V_normal_max=${maxNormalVoltage}V)`);
  }

  const criticalJ_at_1pct = conc1.criticalCurrentDensity;
  assertLT(criticalJ_at_1pct, currentDensity, GROUP,
    `1%浓度临界电流密度应<施加电流密度 (Jc=${criticalJ_at_1pct}, J_applied=${currentDensity})`);

  console.log(`\n  浓度扫描结果 (J=${currentDensity} A/cm²):`);
  console.log('  ' + '-'.repeat(75));
  console.log('  浓度(%)\t临界J\t\t局部J\t\t覆盖率\t\t电压(V)\t\tAE');
  console.log('  ' + '-'.repeat(75));
  results.forEach((r, i) => {
    const aeMark = r.isAnodeEffect ? '⚠️AE' : '  OK';
    console.log(`  ${concentrations[i]}%\t\t${r.criticalCurrentDensity.toFixed(3)}\t\t${r.localCurrentDensity.toFixed(3)}\t\t${(r.bubbleCoverage * 100).toFixed(1)}%\t\t${r.cellVoltage.toFixed(2)}\t\t${aeMark}`);
  });
}

async function testGroup2_effectTriggerConcentrationShifts() {
  const GROUP = '测试2: 电流密度从0.5到1.5A/cm²变化时效应触发浓度是否变化';
  console.log(`\n📋 ${GROUP}`);
  console.log('-'.repeat(60));

  const currentDensities = [0.5, 0.7, 0.8, 1.0, 1.2, 1.5];
  const testConcentrations = [];
  for (let c = 0.5; c <= 8.0; c += 0.25) testConcentrations.push(Math.round(c * 100) / 100);

  const triggerConcentrations = [];

  currentDensities.forEach(j => {
    let triggerConc = null;
    for (let i = 1; i < testConcentrations.length; i++) {
      const rAtLowConc = simulate(j, testConcentrations[i - 1], 0, 0);
      const rAtHighConc = simulate(j, testConcentrations[i], 0, 0);
      if (rAtLowConc.isAnodeEffect && !rAtHighConc.isAnodeEffect) {
        triggerConc = testConcentrations[i - 1];
        break;
      }
    }
    if (!triggerConc) {
      const r0 = simulate(j, testConcentrations[testConcentrations.length - 1], 0, 0);
      if (r0.isAnodeEffect) triggerConc = testConcentrations[testConcentrations.length - 1];
    }
    triggerConcentrations.push(triggerConc);
  });

  assert(triggerConcentrations.every(c => c !== null), GROUP, '所有电流密度都应能找到效应触发浓度');

  let isMonotonic = true;
  for (let i = 1; i < triggerConcentrations.length; i++) {
    if (triggerConcentrations[i] < triggerConcentrations[i - 1]) {
      isMonotonic = false;
      break;
    }
  }
  assert(isMonotonic, GROUP,
    `触发浓度应随电流密度增加而单调递增 (${triggerConcentrations.map((c, i) => `J=${currentDensities[i]}→${c}%`).join(', ')})`);

  if (triggerConcentrations[0] !== null && triggerConcentrations[triggerConcentrations.length - 1] !== null) {
    assertGT(triggerConcentrations[triggerConcentrations.length - 1], triggerConcentrations[0], GROUP,
      `J=1.5触发浓度应>J=0.5触发浓度 (${triggerConcentrations[triggerConcentrations.length - 1]}% > ${triggerConcentrations[0]}%)`);
  }

  const j05_trigger = triggerConcentrations[0];
  const j15_trigger = triggerConcentrations[triggerConcentrations.length - 1];
  const triggerDiff = j15_trigger - j05_trigger;
  assertGT(triggerDiff, 1.0, GROUP,
    `J=0.5与J=1.5的触发浓度差应>1% (实际差值=${triggerDiff.toFixed(2)}%)`);

  const j05_criticalJ = calculateCriticalCurrentDensity(j05_trigger + 0.5);
  const j15_criticalJ = calculateCriticalCurrentDensity(j15_trigger + 0.5);
  assertGT(j15_criticalJ, j05_criticalJ, GROUP,
    `高浓度下J=1.5的临界J应>J=0.5的临界J (Jc@J1.5=${j15_criticalJ.toFixed(3)} > Jc@J0.5=${j05_criticalJ.toFixed(3)})`);

  console.log(`\n  触发浓度 vs 电流密度:`);
  console.log('  ' + '-'.repeat(50));
  currentDensities.forEach((j, i) => {
    const tc = triggerConcentrations[i];
    const result = simulate(j, tc !== null ? tc : 5.0, 0, 0);
    console.log(`  J=${j.toFixed(1)} A/cm² → 触发浓度≈${tc}%  (Jc=${result.criticalCurrentDensity.toFixed(3)}, J_local=${result.localCurrentDensity.toFixed(3)})`);
  });

  const r_normal = simulate(0.5, 5.0, 0, 0);
  const r_lowConc = simulate(0.5, 1.0, 0, 0);
  const r_highJ = simulate(1.5, 5.0, 0, 0);

  assert(!r_normal.isAnodeEffect, GROUP,
    `J=0.5, Al₂O₃=5%时应为正常运行 (AE=${r_normal.isAnodeEffect})`);

  assert(r_highJ.isAnodeEffect || r_highJ.localCurrentDensity > r_normal.localCurrentDensity, GROUP,
    `J=1.5局部电流密度应>J=0.5 (J_local@1.5=${r_highJ.localCurrentDensity.toFixed(3)} vs J_local@0.5=${r_normal.localCurrentDensity.toFixed(3)})`);

  const coverage_at_05 = simulate(0.5, 3.0, 0, 0).bubbleCoverage;
  const coverage_at_15 = simulate(1.5, 3.0, 0, 0).bubbleCoverage;
  assertGT(coverage_at_15, coverage_at_05, GROUP,
    `J=1.5气泡覆盖率应>J=0.5 (θ@1.5=${(coverage_at_15 * 100).toFixed(1)}% vs θ@0.5=${(coverage_at_05 * 100).toFixed(1)}%)`);

  const r_05_1pct = simulate(0.5, 1.0, 0, 0);
  const r_08_1pct = simulate(0.8, 1.0, 0, 0);
  const r_15_1pct = simulate(1.5, 1.0, 0, 0);
  assert(r_15_1pct.isAnodeEffect, GROUP,
    `J=1.5, Al₂O₃=1%时必定触发阳极效应 (AE=${r_15_1pct.isAnodeEffect})`);
  assert(r_05_1pct.isAnodeEffect, GROUP,
    `J=0.5, Al₂O₃=1%时也应触发阳极效应 (正反馈放大) (AE=${r_05_1pct.isAnodeEffect})`);

  if (r_05_1pct.isAnodeEffect && r_15_1pct.isAnodeEffect) {
    assertGT(r_15_1pct.cellVoltage, r_05_1pct.cellVoltage, GROUP,
      `J=1.5的AE电压应>J=0.5的AE电压 (V@1.5=${r_15_1pct.cellVoltage}V vs V@0.5=${r_05_1pct.cellVoltage}V)`);
  }
}

async function testGroup3_snapshotEventMarkers() {
  const GROUP = '测试3: 后端槽电压数据是否已增加效应事件标记和时间序列';
  console.log(`\n📋 ${GROUP}`);
  console.log('-'.repeat(60));

  let runId = null;
  try {
    const simResult = simulate(0.8, 1.5, 0, 5);
    const saveRunRes = await httpRequest('POST', '/api/save-run', simResult);
    assert(saveRunRes.success, GROUP, '保存运行记录成功');
    runId = saveRunRes.runId;
    assertExists(runId, GROUP, '返回有效的runId');

    const snapshotDataNormal = {
      currentDensity: 0.8,
      aluminaConcentration: 5.0,
      cellVoltage: 4.5,
      bubbleCoverage: 0.35,
      isAnodeEffect: false,
      arcIntensity: 0,
      localCurrentDensity: 1.23,
      interpolarDistance: 0.045
    };
    const snapNormal = await httpRequest('POST', '/api/save-snapshot', { runId, data: snapshotDataNormal });
    assert(snapNormal.success, GROUP, '保存正常状态快照成功');

    const snapshotDataAE = {
      currentDensity: 0.8,
      aluminaConcentration: 1.0,
      cellVoltage: 35.0,
      bubbleCoverage: 0.85,
      isAnodeEffect: true,
      arcIntensity: 0.7,
      localCurrentDensity: 5.33,
      interpolarDistance: 0.046
    };
    const snapAE = await httpRequest('POST', '/api/save-snapshot', { runId, data: snapshotDataAE });
    assert(snapAE.success, GROUP, '保存阳极效应快照成功');

    const snapshots = await httpRequest('GET', `/api/snapshots/${runId}`);
    assert(Array.isArray(snapshots), GROUP, '快照返回为数组');
    assertGTE(snapshots.length, 2, GROUP, '快照数量≥2');

    const normalSnap = snapshots.find(s => s.is_anode_effect === 0);
    const aeSnap = snapshots.find(s => s.is_anode_effect === 1);

    assertExists(normalSnap, GROUP, '存在is_anode_effect=0的正常快照');
    assertExists(aeSnap, GROUP, '存在is_anode_effect=1的效应快照');

    if (aeSnap) {
      assertEQ(aeSnap.is_anode_effect, 1, GROUP, 'AE快照is_anode_effect=1');
      assertExists(aeSnap.arc_intensity, GROUP, 'AE快照包含arc_intensity字段');
      assertExists(aeSnap.local_current_density, GROUP, 'AE快照包含local_current_density字段');
      assertExists(aeSnap.interpolar_distance, GROUP, 'AE快照包含interpolar_distance字段');
      assertGT(aeSnap.arc_intensity, 0, GROUP, `AE快照arc_intensity>0 (actual=${aeSnap.arc_intensity})`);
      assertGT(aeSnap.local_current_density, 0, GROUP, `AE快照local_current_density>0 (actual=${aeSnap.local_current_density})`);
      assertExists(aeSnap.timestamp, GROUP, 'AE快照包含timestamp字段');
      assert(typeof aeSnap.timestamp === 'string' && aeSnap.timestamp.length > 0, GROUP, 'timestamp为非空字符串');
    }

    if (normalSnap) {
      assertEQ(normalSnap.is_anode_effect, 0, GROUP, '正常快照is_anode_effect=0');
      assertExists(normalSnap.arc_intensity, GROUP, '正常快照包含arc_intensity字段');
      assertExists(normalSnap.local_current_density, GROUP, '正常快照包含local_current_density字段');
    }

    const stats = await httpRequest('GET', '/api/ae-stats');
    assertExists(stats.totalSnapshots, GROUP, '统计API返回totalSnapshots');
    assertExists(stats.aeSnapshots, GROUP, '统计API返回aeSnapshots');
    assertExists(stats.aePercentage, GROUP, '统计API返回aePercentage');
    assertGT(stats.totalSnapshots, 0, GROUP, `总快照数>0 (actual=${stats.totalSnapshots})`);
    assertGT(stats.aeSnapshots, 0, GROUP, `AE快照数>0 (actual=${stats.aeSnapshots})`);
    assertGT(stats.aePercentage, 0, GROUP, `AE百分比>0% (actual=${stats.aePercentage}%)`);

    const aePercentage = (stats.aeSnapshots / stats.totalSnapshots * 100);
    assertApprox(stats.aePercentage, aePercentage, 0.1, GROUP, `AE百分比计算正确`);

    const snapshotDataSequence = [];
    for (let i = 0; i < 5; i++) {
      const conc = 5.0 - i * 1.2;
      const r = simulate(0.8, conc, i * 0.1, i * 2);
      snapshotDataSequence.push({
        currentDensity: r.currentDensity,
        aluminaConcentration: r.aluminaConcentration,
        cellVoltage: r.cellVoltage,
        bubbleCoverage: r.bubbleCoverage,
        isAnodeEffect: r.isAnodeEffect,
        arcIntensity: r.arcIntensity,
        localCurrentDensity: r.localCurrentDensity,
        interpolarDistance: r.interpolarDistance
      });
    }

    for (const snapData of snapshotDataSequence) {
      const res = await httpRequest('POST', '/api/save-snapshot', { runId, data: snapData });
      assert(res.success, GROUP, `序列快照(Al₂O₃=${snapData.aluminaConcentration.toFixed(2)}%)保存成功`);
    }

    const allSnapshots = await httpRequest('GET', `/api/snapshots/${runId}`);
    assertGTE(allSnapshots.length, 7, GROUP, '全部快照数量≥7');

    let hasTimeOrder = true;
    for (let i = 1; i < allSnapshots.length; i++) {
      if (allSnapshots[i].id <= allSnapshots[i - 1].id) {
        hasTimeOrder = false;
        break;
      }
    }
    assert(hasTimeOrder, GROUP, '快照按ID递增(时间序列)排列');

    const aeEventCount = allSnapshots.filter(s => s.is_anode_effect === 1).length;
    const normalEventCount = allSnapshots.filter(s => s.is_anode_effect === 0).length;
    console.log(`\n  时间序列中的AE事件统计:`);
    console.log(`  - 总快照数: ${allSnapshots.length}`);
    console.log(`  - AE事件标记数: ${aeEventCount}`);
    console.log(`  - 正常运行标记数: ${normalEventCount}`);
    console.log(`  - AE事件占比: ${(aeEventCount / allSnapshots.length * 100).toFixed(1)}%`);

    assertGT(aeEventCount, 0, GROUP, `时间序列中存在AE事件标记 (count=${aeEventCount})`);
    assertGT(normalEventCount, 0, GROUP, `时间序列中存在正常运行标记 (count=${normalEventCount})`);

    let aeEventTransitionCount = 0;
    for (let i = 1; i < allSnapshots.length; i++) {
      if (allSnapshots[i].is_anode_effect !== allSnapshots[i - 1].is_anode_effect) {
        aeEventTransitionCount++;
      }
    }
    assertGT(aeEventTransitionCount, 0, GROUP,
      `时间序列中存在正常↔AE的状态跳变 (transitions=${aeEventTransitionCount})`);

  } catch (error) {
    assert(false, GROUP, `API请求失败: ${error.message}`);
  }
}

runAllTests().catch(err => {
  console.error('测试执行异常:', err);
  process.exit(2);
});
