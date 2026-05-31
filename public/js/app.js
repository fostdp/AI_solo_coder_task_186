const API_BASE = '/api';

const state = {
    isRunning: false,
    isPaused: false,
    currentDensity: 0.8,
    aluminaConcentration: 5.0,
    timeFactor: 0,
    elapsedTimeHours: 0,
    simulationStartTime: 0,
    simulationResult: null,
    voltageHistory: [],
    maxVoltageHistory: 200,
    bubbles: [],
    maxBubbles: 150,
    animationId: null,
    lastUpdateTime: 0,
    currentRunId: null,
    snapshotTimer: null
};

const elements = {
    simCanvas: document.getElementById('simulationCanvas'),
    voltageCanvas: document.getElementById('voltageChart'),
    currentDensitySlider: document.getElementById('currentDensity'),
    currentDensityValue: document.getElementById('currentDensityValue'),
    aluminaConcentrationSlider: document.getElementById('aluminaConcentration'),
    aluminaConcentrationValue: document.getElementById('aluminaConcentrationValue'),
    criticalCurrentDensity: document.getElementById('criticalCurrentDensity'),
    localCurrentDensity: document.getElementById('localCurrentDensity'),
    bubbleCoverage: document.getElementById('bubbleCoverage'),
    cellVoltage: document.getElementById('cellVoltage'),
    arcIntensity: document.getElementById('arcIntensity'),
    interpolarDistance: document.getElementById('interpolarDistance'),
    anodeConsumption: document.getElementById('anodeConsumption'),
    elapsedTime: document.getElementById('elapsedTime'),
    anodeEffectWarning: document.getElementById('anodeEffectWarning'),
    anodeEffectStatus: document.getElementById('anodeEffectStatus'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    criticalMark: document.getElementById('criticalMark'),
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resetBtn: document.getElementById('resetBtn'),
    saveBtn: document.getElementById('saveBtn'),
    loadHistoryBtn: document.getElementById('loadHistoryBtn'),
    historyList: document.getElementById('historyList')
};

const simCtx = elements.simCanvas.getContext('2d');
const voltCtx = elements.voltageCanvas.getContext('2d');

function initBubbles() {
    state.bubbles = [];
    for (let i = 0; i < state.maxBubbles; i++) {
        state.bubbles.push(createBubble());
    }
}

function createBubble(initialY = null) {
    const width = elements.simCanvas.width;
    const height = elements.simCanvas.height;
    const size = 2 + Math.random() * 12;
    return {
        x: Math.random() * width,
        y: initialY !== null ? initialY : height * (0.35 + Math.random() * 0.55),
        radius: size / 2,
        speed: 0.3 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        wobble: Math.random() * 1.5,
        opacity: 0.3 + Math.random() * 0.5
    };
}

function updateBubbles(bubbleCoverage, arcIntensity) {
    const width = elements.simCanvas.width;
    const height = elements.simCanvas.height;
    const activeCount = Math.floor(state.maxBubbles * bubbleCoverage);
    
    state.bubbles.forEach((bubble, index) => {
        if (index < activeCount) {
            bubble.y -= bubble.speed;
            bubble.x += Math.sin(state.timeFactor * 3 + bubble.phase) * bubble.wobble * 0.3;
            
            if (bubble.y < height * 0.28) {
                Object.assign(bubble, createBubble(height * 0.95));
            }
            
            if (bubble.x < -10) bubble.x = width + 10;
            if (bubble.x > width + 10) bubble.x = -10;
        }
    });
}

function drawCell() {
    const width = elements.simCanvas.width;
    const height = elements.simCanvas.height;
    
    simCtx.clearRect(0, 0, width, height);
    
    const bgGradient = simCtx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#0a0a1a');
    bgGradient.addColorStop(0.3, '#0d1025');
    bgGradient.addColorStop(0.6, '#0a1525');
    bgGradient.addColorStop(1, '#051015');
    simCtx.fillStyle = bgGradient;
    simCtx.fillRect(0, 0, width, height);
    
    const cellX = 80;
    const cellY = 80;
    const cellWidth = width - 160;
    const cellHeight = height - 160;
    
    const cellGradient = simCtx.createLinearGradient(cellX, cellY, cellX, cellY + cellHeight);
    cellGradient.addColorStop(0, '#2a1810');
    cellGradient.addColorStop(0.3, '#3d2817');
    cellGradient.addColorStop(0.7, '#4a3520');
    cellGradient.addColorStop(1, '#2d1d10');
    
    simCtx.fillStyle = cellGradient;
    simCtx.fillRect(cellX, cellY, cellWidth, cellHeight);
    
    simCtx.strokeStyle = '#5a4030';
    simCtx.lineWidth = 4;
    simCtx.strokeRect(cellX, cellY, cellWidth, cellHeight);
    
    simCtx.strokeStyle = 'rgba(90, 64, 48, 0.3)';
    simCtx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
        const y = cellY + (cellHeight / 5) * i;
        simCtx.beginPath();
        simCtx.moveTo(cellX + 10, y);
        simCtx.lineTo(cellX + cellWidth - 10, y);
        simCtx.stroke();
    }
    
    drawCryolite(cellX, cellY, cellWidth, cellHeight);
    drawAnodes(cellX, cellY, cellWidth, cellHeight);
    drawCathode(cellX, cellY, cellWidth, cellHeight);
}

function drawCryolite(cellX, cellY, cellWidth, cellHeight) {
    const meltTop = cellY + cellHeight * 0.25;
    const meltBottom = cellY + cellHeight * 0.9;
    const meltHeight = meltBottom - meltTop;
    
    const simResult = state.simulationResult;
    const bubbleCoverage = simResult ? simResult.bubbleCoverage : 0.1;
    
    const meltGradient = simCtx.createLinearGradient(cellX, meltTop, cellX, meltBottom);
    
    if (simResult && simResult.isAnodeEffect) {
        meltGradient.addColorStop(0, 'rgba(255, 100, 50, 0.9)');
        meltGradient.addColorStop(0.3, 'rgba(200, 80, 40, 0.85)');
        meltGradient.addColorStop(0.7, 'rgba(150, 60, 30, 0.8)');
        meltGradient.addColorStop(1, 'rgba(100, 40, 20, 0.75)');
    } else {
        meltGradient.addColorStop(0, 'rgba(100, 180, 255, 0.7)');
        meltGradient.addColorStop(0.3, 'rgba(60, 140, 220, 0.75)');
        meltGradient.addColorStop(0.7, 'rgba(40, 100, 180, 0.8)');
        meltGradient.addColorStop(1, 'rgba(20, 60, 120, 0.85)');
    }
    
    simCtx.fillStyle = meltGradient;
    simCtx.fillRect(cellX + 5, meltTop, cellWidth - 10, meltHeight);
    
    for (let i = 0; i < 5; i++) {
        const waveY = meltTop + 5 + i * 8;
        const waveOpacity = 0.3 - i * 0.05;
        simCtx.strokeStyle = `rgba(255, 255, 255, ${waveOpacity})`;
        simCtx.lineWidth = 1;
        simCtx.beginPath();
        for (let x = cellX + 5; x < cellX + cellWidth - 5; x += 5) {
            const yOffset = Math.sin((x + state.timeFactor * 50) * 0.05) * 2;
            if (x === cellX + 5) {
                simCtx.moveTo(x, waveY + yOffset);
            } else {
                simCtx.lineTo(x, waveY + yOffset);
            }
        }
        simCtx.stroke();
    }
    
    drawBubbles(cellX, meltTop, cellWidth, meltHeight, bubbleCoverage);
    
    if (simResult && simResult.isAnodeEffect && simResult.arcIntensity > 0) {
        drawArcDischarges(cellX, meltTop, cellWidth, cellHeight, simResult.arcIntensity);
    }
}

function drawBubbles(cellX, meltTop, cellWidth, meltHeight, bubbleCoverage) {
    const activeCount = Math.floor(state.maxBubbles * bubbleCoverage);
    
    for (let i = 0; i < activeCount; i++) {
        const bubble = state.bubbles[i];
        if (bubble.y > meltTop && bubble.y < meltTop + meltHeight) {
            const inMeltRatio = (bubble.y - meltTop) / meltHeight;
            const sizeMultiplier = 0.5 + inMeltRatio * 0.5;
            
            simCtx.beginPath();
            simCtx.arc(bubble.x, bubble.y, bubble.radius * sizeMultiplier, 0, Math.PI * 2);
            
            const gradient = simCtx.createRadialGradient(
                bubble.x - bubble.radius * 0.3,
                bubble.y - bubble.radius * 0.3,
                0,
                bubble.x,
                bubble.y,
                bubble.radius * sizeMultiplier
            );
            
            if (state.simulationResult && state.simulationResult.isAnodeEffect) {
                gradient.addColorStop(0, `rgba(255, 200, 100, ${bubble.opacity})`);
                gradient.addColorStop(0.5, `rgba(255, 150, 50, ${bubble.opacity * 0.6})`);
                gradient.addColorStop(1, `rgba(255, 100, 0, ${bubble.opacity * 0.2})`);
            } else {
                gradient.addColorStop(0, `rgba(255, 255, 255, ${bubble.opacity})`);
                gradient.addColorStop(0.5, `rgba(200, 230, 255, ${bubble.opacity * 0.6})`);
                gradient.addColorStop(1, `rgba(100, 180, 255, ${bubble.opacity * 0.2})`);
            }
            
            simCtx.fillStyle = gradient;
            simCtx.fill();
            
            simCtx.beginPath();
            simCtx.arc(
                bubble.x - bubble.radius * 0.3,
                bubble.y - bubble.radius * 0.3,
                bubble.radius * 0.2,
                0, Math.PI * 2
            );
            simCtx.fillStyle = `rgba(255, 255, 255, ${bubble.opacity * 0.8})`;
            simCtx.fill();
        }
    }
}

function drawAnodes(cellX, cellY, cellWidth, cellHeight) {
    const anodeCount = 4;
    const anodeWidth = (cellWidth - 80) / anodeCount - 15;
    const anodeHeight = cellHeight * 0.35;
    const anodeTop = cellY - 20;
    const anodeBottom = anodeTop + anodeHeight;
    const startX = cellX + 40;
    
    const simResult = state.simulationResult;
    const bubbleCoverage = simResult ? simResult.bubbleCoverage : 0;
    const arcIntensity = simResult ? simResult.arcIntensity : 0;
    
    for (let i = 0; i < anodeCount; i++) {
        const x = startX + i * (anodeWidth + 15);
        
        const anodeGradient = simCtx.createLinearGradient(x, anodeTop, x, anodeBottom);
        anodeGradient.addColorStop(0, '#2a2a2a');
        anodeGradient.addColorStop(0.3, '#3a3a3a');
        anodeGradient.addColorStop(0.7, '#2d2d2d');
        anodeGradient.addColorStop(1, '#1a1a1a');
        
        simCtx.fillStyle = anodeGradient;
        simCtx.fillRect(x, anodeTop, anodeWidth, anodeHeight);
        
        simCtx.strokeStyle = '#444';
        simCtx.lineWidth = 2;
        simCtx.strokeRect(x, anodeTop, anodeWidth, anodeHeight);
        
        simCtx.strokeStyle = 'rgba(60, 60, 60, 0.5)';
        simCtx.lineWidth = 1;
        for (let ly = anodeTop + 20; ly < anodeBottom - 10; ly += 25) {
            simCtx.beginPath();
            simCtx.moveTo(x + 5, ly);
            simCtx.lineTo(x + anodeWidth - 5, ly);
            simCtx.stroke();
        }
        
        const bubbleLayerHeight = anodeHeight * 0.15 * bubbleCoverage;
        if (bubbleLayerHeight > 2) {
            const bubbleGradient = simCtx.createLinearGradient(x, anodeBottom - bubbleLayerHeight, x, anodeBottom);
            
            if (simResult && simResult.isAnodeEffect) {
                bubbleGradient.addColorStop(0, 'rgba(255, 150, 50, 0.6)');
                bubbleGradient.addColorStop(1, 'rgba(255, 100, 0, 0.8)');
            } else {
                bubbleGradient.addColorStop(0, 'rgba(100, 180, 255, 0.4)');
                bubbleGradient.addColorStop(1, 'rgba(50, 100, 200, 0.6)');
            }
            
            simCtx.fillStyle = bubbleGradient;
            simCtx.fillRect(x + 2, anodeBottom - bubbleLayerHeight, anodeWidth - 4, bubbleLayerHeight);
        }
        
        simCtx.fillStyle = '#666';
        simCtx.fillRect(x + anodeWidth / 2 - 5, anodeTop - 40, 10, 40);
        
        if (simResult && simResult.isAnodeEffect && arcIntensity > 0.2) {
            drawAnodeGlow(x, anodeBottom, anodeWidth, arcIntensity);
        }
    }
}

function drawAnodeGlow(x, anodeBottom, width, intensity) {
    const glowHeight = 50 * intensity;
    const gradient = simCtx.createRadialGradient(
        x + width / 2, anodeBottom, 0,
        x + width / 2, anodeBottom + glowHeight, width
    );
    
    gradient.addColorStop(0, `rgba(255, 200, 100, ${0.8 * intensity})`);
    gradient.addColorStop(0.3, `rgba(255, 150, 50, ${0.5 * intensity})`);
    gradient.addColorStop(0.6, `rgba(255, 100, 0, ${0.2 * intensity})`);
    gradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
    
    simCtx.fillStyle = gradient;
    simCtx.fillRect(x - width * 0.2, anodeBottom, width * 1.4, glowHeight);
}

function drawCathode(cellX, cellY, cellWidth, cellHeight) {
    const cathodeY = cellY + cellHeight * 0.85;
    const cathodeHeight = cellHeight * 0.12;
    
    const cathodeGradient = simCtx.createLinearGradient(cellX, cathodeY, cellX, cathodeY + cathodeHeight);
    cathodeGradient.addColorStop(0, '#4a4a5a');
    cathodeGradient.addColorStop(0.5, '#3a3a4a');
    cathodeGradient.addColorStop(1, '#2a2a3a');
    
    simCtx.fillStyle = cathodeGradient;
    simCtx.fillRect(cellX + 10, cathodeY, cellWidth - 20, cathodeHeight);
    
    simCtx.strokeStyle = '#5a5a6a';
    simCtx.lineWidth = 2;
    simCtx.strokeRect(cellX + 10, cathodeY, cellWidth - 20, cathodeHeight);
    
    const alGradient = simCtx.createLinearGradient(cellX, cathodeY - 15, cellX, cathodeY);
    alGradient.addColorStop(0, 'rgba(180, 180, 200, 0.9)');
    alGradient.addColorStop(0.5, 'rgba(150, 150, 170, 0.95)');
    alGradient.addColorStop(1, 'rgba(120, 120, 140, 1)');
    
    simCtx.fillStyle = alGradient;
    simCtx.fillRect(cellX + 15, cathodeY - 15, cellWidth - 30, 15);
    
    simCtx.fillStyle = '#888';
    simCtx.fillRect(cellX + cellWidth / 2 - 5, cathodeY + cathodeHeight, 10, 30);
}

function drawArcDischarges(cellX, meltTop, cellWidth, cellHeight, intensity) {
    const arcCount = Math.floor(3 + intensity * 8);
    
    for (let i = 0; i < arcCount; i++) {
        if (Math.random() > intensity * 0.8 + 0.1) continue;
        
        const startX = cellX + 50 + Math.random() * (cellWidth - 100);
        const startY = meltTop + 30 + Math.random() * 50;
        const endX = startX + (Math.random() - 0.5) * 80;
        const endY = startY + 40 + Math.random() * 60;
        
        drawSingleArc(startX, startY, endX, endY, intensity);
    }
}

function drawSingleArc(x1, y1, x2, y2, intensity) {
    const segments = 8;
    const dx = (x2 - x1) / segments;
    const dy = (y2 - y1) / segments;
    
    simCtx.beginPath();
    simCtx.moveTo(x1, y1);
    
    for (let i = 1; i <= segments; i++) {
        const offsetX = (Math.random() - 0.5) * 15 * intensity;
        const offsetY = (Math.random() - 0.5) * 15 * intensity;
        simCtx.lineTo(x1 + dx * i + offsetX, y1 + dy * i + offsetY);
    }
    
    simCtx.strokeStyle = `rgba(255, 255, 200, ${0.8 + Math.random() * 0.2})`;
    simCtx.lineWidth = 2 + intensity * 3;
    simCtx.lineCap = 'round';
    simCtx.stroke();
    
    simCtx.beginPath();
    simCtx.moveTo(x1, y1);
    for (let i = 1; i <= segments; i++) {
        const offsetX = (Math.random() - 0.5) * 10 * intensity;
        const offsetY = (Math.random() - 0.5) * 10 * intensity;
        simCtx.lineTo(x1 + dx * i + offsetX, y1 + dy * i + offsetY);
    }
    simCtx.strokeStyle = `rgba(255, 150, 50, ${0.6 + Math.random() * 0.4})`;
    simCtx.lineWidth = 1;
    simCtx.stroke();
    
    const glowGradient = simCtx.createRadialGradient(x1, y1, 0, (x1 + x2) / 2, (y1 + y2) / 2, 60);
    glowGradient.addColorStop(0, `rgba(255, 200, 100, ${0.3 * intensity})`);
    glowGradient.addColorStop(0.5, `rgba(255, 100, 0, ${0.1 * intensity})`);
    glowGradient.addColorStop(1, 'rgba(255, 50, 0, 0)');
    
    simCtx.fillStyle = glowGradient;
    simCtx.fillRect(Math.min(x1, x2) - 60, Math.min(y1, y2) - 60, 
                   Math.abs(x2 - x1) + 120, Math.abs(y2 - y1) + 120);
}

function drawLabels() {
    const width = elements.simCanvas.width;
    const height = elements.simCanvas.height;
    
    simCtx.font = 'bold 14px "Microsoft YaHei", sans-serif';
    simCtx.textAlign = 'center';
    
    simCtx.fillStyle = '#888';
    simCtx.fillText('阳极 (碳块)', width / 2, 40);
    
    simCtx.fillStyle = '#6ab0ff';
    simCtx.fillText('冰晶石熔盐 (Na₃AlF₆)', width / 2, height - 120);
    
    simCtx.fillStyle = '#aaa';
    simCtx.fillText('铝液层', width / 2, height - 55);
    
    simCtx.fillStyle = '#555';
    simCtx.fillText('阴极 (碳块)', width / 2, height - 25);
    
    simCtx.font = '12px "Microsoft YaHei", sans-serif';
    simCtx.textAlign = 'left';
    simCtx.fillStyle = '#666';
    simCtx.fillText('+', 55, 70);
    simCtx.fillText('直流电源', 80, 70);
    simCtx.fillText('-', 55, height - 55);
    
    if (state.simulationResult) {
        simCtx.textAlign = 'right';
        simCtx.font = '12px "Microsoft YaHei", sans-serif';
        const sim = state.simulationResult;
        
        const statusText = sim.isAnodeEffect ? '⚠️ 阳极效应发生中' : '✓ 正常电解';
        const statusColor = sim.isAnodeEffect ? '#ff6b6b' : '#51cf66';
        
        simCtx.fillStyle = statusColor;
        simCtx.font = 'bold 13px "Microsoft YaHei", sans-serif';
        simCtx.fillText(statusText, width - 20, height - 80);
        
        simCtx.font = '11px "Microsoft YaHei", sans-serif';
        simCtx.fillStyle = '#888';
        simCtx.fillText(`J/J临界: ${(sim.currentDensity / sim.criticalCurrentDensity).toFixed(2)}`, width - 20, height - 60);
    }
}

function drawVoltageChart() {
    const width = elements.voltageCanvas.width;
    const height = elements.voltageCanvas.height;
    
    voltCtx.clearRect(0, 0, width, height);
    
    const bgGradient = voltCtx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#0a0a1a');
    bgGradient.addColorStop(1, '#1a1a3a');
    voltCtx.fillStyle = bgGradient;
    voltCtx.fillRect(0, 0, width, height);
    
    voltCtx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
    voltCtx.lineWidth = 1;
    
    for (let i = 0; i <= 5; i++) {
        const y = (height / 5) * i;
        voltCtx.beginPath();
        voltCtx.moveTo(50, y);
        voltCtx.lineTo(width - 10, y);
        voltCtx.stroke();
    }
    
    if (state.voltageHistory.length < 2) return;
    
    const maxVoltage = Math.max(...state.voltageHistory, 30) * 1.1;
    const minVoltage = 0;
    const voltageRange = maxVoltage - minVoltage;
    
    const chartLeft = 55;
    const chartRight = width - 15;
    const chartWidth = chartRight - chartLeft;
    
    voltCtx.strokeStyle = 'rgba(255, 107, 107, 0.5)';
    voltCtx.setLineDash([5, 5]);
    const criticalY = height - (30 / voltageRange) * height;
    voltCtx.beginPath();
    voltCtx.moveTo(chartLeft, criticalY);
    voltCtx.lineTo(chartRight, criticalY);
    voltCtx.stroke();
    voltCtx.setLineDash([]);
    
    voltCtx.fillStyle = '#ff6b6b';
    voltCtx.font = '10px sans-serif';
    voltCtx.textAlign = 'left';
    voltCtx.fillText('AE阈值', chartRight - 50, criticalY - 5);
    
    voltCtx.beginPath();
    const step = chartWidth / (state.maxVoltageHistory - 1);
    
    state.voltageHistory.forEach((voltage, index) => {
        const x = chartLeft + index * step;
        const y = height - ((voltage - minVoltage) / voltageRange) * height;
        
        if (index === 0) {
            voltCtx.moveTo(x, y);
        } else {
            voltCtx.lineTo(x, y);
        }
    });
    
    const lineGradient = voltCtx.createLinearGradient(chartLeft, 0, chartRight, 0);
    lineGradient.addColorStop(0, '#00d4ff');
    lineGradient.addColorStop(0.5, '#7c3aed');
    lineGradient.addColorStop(1, '#f472b6');
    
    voltCtx.strokeStyle = lineGradient;
    voltCtx.lineWidth = 2;
    voltCtx.stroke();
    
    const fillGradient = voltCtx.createLinearGradient(0, 0, 0, height);
    fillGradient.addColorStop(0, 'rgba(0, 212, 255, 0.2)');
    fillGradient.addColorStop(1, 'rgba(0, 212, 255, 0)');
    
    voltCtx.lineTo(chartLeft + (state.voltageHistory.length - 1) * step, height);
    voltCtx.lineTo(chartLeft, height);
    voltCtx.closePath();
    voltCtx.fillStyle = fillGradient;
    voltCtx.fill();
    
    if (state.simulationResult) {
        const lastX = chartLeft + (state.voltageHistory.length - 1) * step;
        const lastY = height - ((state.simulationResult.cellVoltage - minVoltage) / voltageRange) * height;
        
        voltCtx.beginPath();
        voltCtx.arc(lastX, lastY, 5, 0, Math.PI * 2);
        voltCtx.fillStyle = state.simulationResult.isAnodeEffect ? '#ff6b6b' : '#00d4ff';
        voltCtx.fill();
        voltCtx.strokeStyle = '#fff';
        voltCtx.lineWidth = 2;
        voltCtx.stroke();
    }
    
    voltCtx.fillStyle = '#888';
    voltCtx.font = '10px sans-serif';
    voltCtx.textAlign = 'right';
    
    for (let i = 0; i <= 5; i++) {
        const voltage = (maxVoltage / 5) * i;
        const y = height - (i / 5) * height;
        voltCtx.fillText(voltage.toFixed(0) + 'V', 48, y + 3);
    }
}

function updateUI(result) {
    elements.criticalCurrentDensity.textContent = result.criticalCurrentDensity.toFixed(3) + ' A/cm²';
    elements.localCurrentDensity.textContent = result.localCurrentDensity.toFixed(3) + ' A/cm²';
    elements.bubbleCoverage.textContent = (result.bubbleCoverage * 100).toFixed(1) + '%';
    elements.cellVoltage.textContent = result.cellVoltage.toFixed(2) + ' V';
    elements.arcIntensity.textContent = (result.arcIntensity * 100).toFixed(0) + '%';
    elements.interpolarDistance.textContent = (result.interpolarDistance * 1000).toFixed(1) + ' mm';
    elements.anodeConsumption.textContent = (result.anodeConsumption * 1000).toFixed(2) + ' mm';
    elements.elapsedTime.textContent = result.elapsedTimeHours.toFixed(2) + ' h';
    
    const criticalPosition = (result.criticalCurrentDensity / 3) * 100;
    elements.criticalMark.style.marginLeft = `${criticalPosition - 50}%`;
    elements.criticalMark.textContent = `临界(${result.criticalCurrentDensity.toFixed(2)})`;
    
    if (result.isAnodeEffect) {
        elements.anodeEffectWarning.style.display = 'block';
        elements.anodeEffectStatus.textContent = '已发生';
        elements.statusDot.className = 'status-dot danger';
        elements.statusText.textContent = '阳极效应告警';
    } else if (result.isAnodeEffectImminent || result.localCurrentDensity >= result.criticalCurrentDensity * 0.85) {
        elements.anodeEffectWarning.style.display = 'none';
        elements.statusDot.className = 'status-dot warning';
        elements.statusText.textContent = 'AE预警';
    } else if (result.localCurrentDensity >= result.criticalCurrentDensity * 0.7) {
        elements.anodeEffectWarning.style.display = 'none';
        elements.statusDot.className = 'status-dot warning';
        elements.statusText.textContent = '接近临界值';
    } else {
        elements.anodeEffectWarning.style.display = 'none';
        elements.statusDot.className = 'status-dot';
        elements.statusText.textContent = '正常运行';
    }
    
    state.voltageHistory.push(result.cellVoltage);
    if (state.voltageHistory.length > state.maxVoltageHistory) {
        state.voltageHistory.shift();
    }
}

async function simulate() {
    try {
        const response = await fetch(`${API_BASE}/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentDensity: state.currentDensity,
                aluminaConcentration: state.aluminaConcentration,
                timeFactor: state.timeFactor,
                elapsedTimeHours: state.elapsedTimeHours
            })
        });
        
        const result = await response.json();
        state.simulationResult = result;
        updateUI(result);
        return result;
    } catch (error) {
        console.error('模拟请求失败:', error);
        return null;
    }
}

async function saveRun() {
    if (!state.simulationResult) return;
    
    try {
        const response = await fetch(`${API_BASE}/save-run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.simulationResult)
        });
        
        const data = await response.json();
        if (data.success) {
            state.currentRunId = data.runId;
            startSnapshotSaving();
        }
    } catch (error) {
        console.error('保存运行记录失败:', error);
    }
}

function startSnapshotSaving() {
    if (state.snapshotTimer) {
        clearInterval(state.snapshotTimer);
    }
    
    state.snapshotTimer = setInterval(async () => {
        if (!state.currentRunId || !state.simulationResult || !state.isRunning || state.isPaused) return;
        
        try {
            await fetch(`${API_BASE}/save-snapshot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    runId: state.currentRunId,
                    data: {
                        currentDensity: state.currentDensity,
                        aluminaConcentration: state.aluminaConcentration,
                        cellVoltage: state.simulationResult.cellVoltage,
                        bubbleCoverage: state.simulationResult.bubbleCoverage,
                        isAnodeEffect: state.simulationResult.isAnodeEffect,
                        arcIntensity: state.simulationResult.arcIntensity,
                        localCurrentDensity: state.simulationResult.localCurrentDensity,
                        interpolarDistance: state.simulationResult.interpolarDistance
                    }
                })
            });
        } catch (error) {
            console.error('保存快照失败:', error);
        }
    }, 2000);
}

async function loadHistory() {
    try {
        const response = await fetch(`${API_BASE}/runs?limit=50`);
        const runs = await response.json();
        
        if (runs.length === 0) {
            elements.historyList.innerHTML = '<p class="empty-hint">暂无历史记录</p>';
            return;
        }
        
        elements.historyList.innerHTML = runs.map(run => {
            const time = new Date(run.timestamp).toLocaleString('zh-CN');
            const aeClass = run.is_anode_effect ? 'ae' : 'normal';
            const aeText = run.is_anode_effect ? '⚠️ AE' : '✓ 正常';
            
            return `
                <div class="history-item" data-run-id="${run.id}">
                    <div class="history-time">${time}</div>
                    <div class="history-params">
                        <span>J=${run.current_density.toFixed(2)}</span>
                        <span>Al₂O₃=${run.alumina_concentration.toFixed(1)}%</span>
                        <span>U=${run.cell_voltage.toFixed(1)}V</span>
                        <span class="${aeClass}">${aeText}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const runId = parseInt(item.dataset.runId);
                loadRunSnapshots(runId);
            });
        });
    } catch (error) {
        console.error('加载历史记录失败:', error);
    }
}

async function loadRunSnapshots(runId) {
    try {
        const response = await fetch(`${API_BASE}/snapshots/${runId}`);
        const snapshots = await response.json();
        
        if (snapshots.length > 0) {
            state.voltageHistory = snapshots.map(s => s.cell_voltage);
            state.simulationResult = {
                currentDensity: snapshots[snapshots.length - 1].current_density,
                aluminaConcentration: snapshots[snapshots.length - 1].alumina_concentration,
                cellVoltage: snapshots[snapshots.length - 1].cell_voltage,
                bubbleCoverage: snapshots[snapshots.length - 1].bubble_coverage
            };
        }
    } catch (error) {
        console.error('加载快照失败:', error);
    }
}

function animate(timestamp) {
    if (!state.isRunning) return;
    
    if (state.isPaused) {
        state.animationId = requestAnimationFrame(animate);
        return;
    }
    
    const deltaTime = timestamp - state.lastUpdateTime;
    if (deltaTime >= 50) {
        state.timeFactor += 0.02;
        state.elapsedTimeHours += deltaTime / 1000 / 3600 * 100;
        state.lastUpdateTime = timestamp;
        
        simulate();
        
        if (state.simulationResult) {
            updateBubbles(state.simulationResult.bubbleCoverage, state.simulationResult.arcIntensity);
        }
    }
    
    drawCell();
    drawLabels();
    drawVoltageChart();
    
    state.animationId = requestAnimationFrame(animate);
}

function startSimulation() {
    state.isRunning = true;
    state.isPaused = false;
    state.lastUpdateTime = performance.now();
    
    elements.startBtn.disabled = true;
    elements.pauseBtn.disabled = false;
    
    saveRun();
    animate(performance.now());
}

function pauseSimulation() {
    state.isPaused = !state.isPaused;
    elements.pauseBtn.textContent = state.isPaused ? '▶ 继续' : '⏸ 暂停';
}

function resetSimulation() {
    state.isRunning = false;
    state.isPaused = false;
    state.timeFactor = 0;
    state.elapsedTimeHours = 0;
    state.voltageHistory = [];
    state.simulationResult = null;
    state.currentRunId = null;
    
    if (state.snapshotTimer) {
        clearInterval(state.snapshotTimer);
        state.snapshotTimer = null;
    }
    
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
    }
    
    state.currentDensity = 0.8;
    state.aluminaConcentration = 5.0;
    elements.currentDensitySlider.value = 0.8;
    elements.aluminaConcentrationSlider.value = 5.0;
    elements.currentDensityValue.textContent = '0.80 A/cm²';
    elements.aluminaConcentrationValue.textContent = '5.00 %';
    
    elements.startBtn.disabled = false;
    elements.pauseBtn.disabled = true;
    elements.pauseBtn.textContent = '⏸ 暂停';
    
    elements.criticalCurrentDensity.textContent = '-';
    elements.localCurrentDensity.textContent = '-';
    elements.bubbleCoverage.textContent = '-';
    elements.cellVoltage.textContent = '-';
    elements.arcIntensity.textContent = '-';
    elements.interpolarDistance.textContent = '-';
    elements.anodeConsumption.textContent = '-';
    elements.elapsedTime.textContent = '-';
    elements.anodeEffectWarning.style.display = 'none';
    elements.statusDot.className = 'status-dot';
    elements.statusText.textContent = '正常运行';
    
    initBubbles();
    drawCell();
    drawLabels();
    drawVoltageChart();
}

function initEventListeners() {
    elements.currentDensitySlider.addEventListener('input', (e) => {
        state.currentDensity = parseFloat(e.target.value);
        elements.currentDensityValue.textContent = state.currentDensity.toFixed(2) + ' A/cm²';
        
        if (state.isRunning && !state.isPaused) {
            simulate();
        }
    });
    
    elements.aluminaConcentrationSlider.addEventListener('input', (e) => {
        state.aluminaConcentration = parseFloat(e.target.value);
        elements.aluminaConcentrationValue.textContent = state.aluminaConcentration.toFixed(2) + ' %';
        
        if (state.isRunning && !state.isPaused) {
            simulate();
        }
    });
    
    elements.startBtn.addEventListener('click', startSimulation);
    elements.pauseBtn.addEventListener('click', pauseSimulation);
    elements.resetBtn.addEventListener('click', resetSimulation);
    elements.saveBtn.addEventListener('click', saveRun);
    elements.loadHistoryBtn.addEventListener('click', loadHistory);
}

function init() {
    initBubbles();
    initEventListeners();
    drawCell();
    drawLabels();
    drawVoltageChart();
    loadHistory();
    
    simulate();
}

init();
