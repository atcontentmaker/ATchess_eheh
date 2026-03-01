/**
 * CHESS ANALYSIS MODULE - FULL INTEGRATED VERSION
 */

const PIECE_VALUES = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 };

const CLASSIFICATION_META = {
    brilliant:  { label: 'Brilliant',  emoji: '!!', color: '#1baca6' },
    great:      { label: 'Great Move', emoji: '!',  color: '#5c8bb0' },
    best:       { label: 'Best',       emoji: '⭐', color: '#95bb4a' },
    excellent:  { label: 'Excellent',  emoji: '✓',  color: '#95bb4a' },
    good:       { label: 'Good',       emoji: '✓',  color: '#81c995' },
    inaccuracy: { label: 'Inaccuracy', emoji: '?!', color: '#f6c90e' },
    mistake:    { label: 'Mistake',    emoji: '?',  color: '#f5a623' },
    missedWin:  { label: 'Missed Win', emoji: '??', color: '#dbac16' },
    blunder:    { label: 'Blunder',    emoji: '??', color: '#e05252' },
};

// 1. CSS Injection (The missing piece)
function injectAnalysisStyles() {
    if (document.getElementById('analysis-styles')) return;
    const style = document.createElement('style');
    style.id = 'analysis-styles';
    style.innerHTML = `
        #analysis-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 9999;
            display: flex; justify-content: center; align-items: center;
        }
        #analysis-window {
            background: #262421; width: 90%; max-width: 800px; height: 80vh;
            border-radius: 8px; display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5); border: 1px solid #3d3b37;
        }
        #analysis-moves { flex: 1; overflow-y: auto; padding: 10px; }
        .analysis-move-row {
            display: grid; grid-template-columns: 50px 80px 80px 80px 1fr;
            align-items: center; padding: 12px; border-bottom: 1px solid #312e2b;
            font-family: monospace; font-size: 14px;
        }
        .move-type-badge {
            justify-self: end; padding: 4px 12px; border-radius: 4px;
            font-weight: bold; font-size: 12px; text-transform: uppercase;
        }
        #analysis-summary { display: flex; background: #21201d; padding: 15px; gap: 20px; }
        .summary-side { flex: 1; border-radius: 4px; padding: 10px; background: #2b2925; }
        .close-analysis {
            padding: 10px; background: #e05252; color: white; border: none;
            cursor: pointer; font-weight: bold; width: 100%;
        }
        #analysis-eval-chart { height: 100px; width: 100%; background: #1a1917; }
    `;
    document.head.appendChild(style);
}

// 2. Core Logic & Math
function cpToWinProb(cp) { return 1 / (1 + Math.pow(10, -cp / 400)); }

function calculateMoveAccuracy(wpBefore, wpAfter) {
    if (wpAfter >= wpBefore) return 100;
    return Math.max(0, 100 * Math.exp(-4 * (wpBefore - wpAfter)));
}

function getMaterialSum(fen) {
    const position = fen.split(' ')[0];
    return [...position].reduce((acc, char) => acc + (PIECE_VALUES[char.toLowerCase()] || 0), 0);
}

function upgradeMoveClassification(m, fenBefore, fenAfter) {
    if (m.side === 'white' && m.evalBefore > 3.0 && m.evalAfter < 1.0) return 'missedWin';
    if (m.side === 'black' && m.evalBefore < -3.0 && m.evalAfter > -1.0) return 'missedWin';
    
    if (m.move === m.bestMove) {
        const matBefore = getMaterialSum(fenBefore);
        const matAfter = getMaterialSum(fenAfter);
        if (matAfter < matBefore && m.evalAfter >= m.evalBefore - 0.5) return 'brilliant';
        return 'best';
    }

    const absSwing = Math.abs(m.swing);
    if (absSwing < 0.2) return 'excellent';
    if (absSwing < 0.5) return 'good';
    if (absSwing < 1.2) return 'inaccuracy';
    if (absSwing < 2.5) return 'mistake';
    return 'blunder';
}

// 3. Engine & Processing
async function getEvaluationFromEngine(fen, depth = 12) {
    return new Promise((resolve) => {
        if (!stockfishWorker) initStockfish();
        const prevHandler = stockfishWorker.onmessage;
        let lastCp = 0;
        stockfishWorker.onmessage = (e) => {
            const line = e.data;
            if (line.includes('score cp')) {
                const match = line.match(/score cp (-?\d+)/);
                if (match) lastCp = parseInt(match[1]);
            } else if (line.includes('score mate')) {
                const match = line.match(/score mate (-?\d+)/);
                if (match) lastCp = parseInt(match[1]) > 0 ? 10000 : -10000;
            }
            if (line.startsWith('bestmove')) {
                stockfishWorker.onmessage = prevHandler;
                resolve({ cp: lastCp, bestMove: line.split(' ')[1] });
            }
        };
        stockfishWorker.postMessage(`position fen ${fen}`);
        stockfishWorker.postMessage(`go depth ${depth}`);
    });
}

async function analyzeGame() {
    const history = game.history({ verbose: true });
    const tempGame = new Chess();
    const results = [];
    
    for (let i = 0; i < history.length; i++) {
        const move = history[i];
        const fenBefore = tempGame.fen();
        const side = tempGame.turn();
        
        const evalBefore = await getEvaluationFromEngine(fenBefore);
        tempGame.move(move);
        const fenAfter = tempGame.fen();
        const evalAfter = await getEvaluationFromEngine(fenAfter);

        const cpBefore = side === 'w' ? evalBefore.cp : -evalBefore.cp;
        const cpAfter = side === 'w' ? evalAfter.cp : -evalAfter.cp;
        const swing = (cpAfter - cpBefore) / 100;

        const res = {
            moveNumber: Math.floor(i/2) + 1,
            move: move.san,
            bestMove: evalBefore.bestMove,
            side: side === 'w' ? 'white' : 'black',
            evalAfter: cpAfter / 100,
            swing: swing,
            type: ''
        };
        res.type = upgradeMoveClassification(res, fenBefore, fenAfter);
        results.push(res);
    }
    return results;
}

// 4. UI Rendering
function showAnalysisOverlay(content) {
    const overlay = document.createElement('div');
    overlay.id = 'analysis-overlay';
    overlay.innerHTML = `
        <div id="analysis-window">
            <div style="padding:15px; background:#1baca6; font-weight:bold;">Game Review</div>
            ${content}
            <button class="close-analysis" onclick="document.getElementById('analysis-overlay').remove()">CLOSE REVIEW</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function renderAnalysisResults(moveAnalysis) {
    const movesHtml = moveAnalysis.map(m => {
        const meta = CLASSIFICATION_META[m.type];
        return `
        <div class="analysis-move-row">
            <span style="color:#888">${m.moveNumber}${m.side === 'white' ? '.' : '...'}</span>
            <span style="font-weight:bold; color:white">${m.move}</span>
            <span style="color:#aaa">${m.evalAfter.toFixed(1)}</span>
            <span style="color:${m.swing < -0.5 ? '#e05252' : '#81c995'}">${m.swing > 0 ? '+' : ''}${m.swing.toFixed(1)}</span>
            <span class="move-type-badge" style="background:${meta.color}22; color:${meta.color};">
                ${meta.emoji} ${meta.label}
            </span>
        </div>`;
    }).join('');

    showAnalysisOverlay(`<div id="analysis-moves">${movesHtml}</div>`);
}

// ── Accuracy helpers ──────────────────────────────────────────────────────────

function _cpToWinProb(cp) {
    return 1 / (1 + Math.pow(10, -Math.max(-1000, Math.min(1000, cp)) / 400));
}

function computeAccuracies(moveAnalysis) {
    const totals = { white: 0, black: 0 };
    const counts = { white: 0, black: 0 };

    moveAnalysis.forEach(m => {
        // evalAfter is from White's POV in pawns; swing is from moving side's POV in pawns
        const cpAfterMovingSide  = m.evalAfter * 100 * (m.side === 'white' ? 1 : -1);
        const cpBeforeMovingSide = cpAfterMovingSide - (m.swing * 100);

        const wpBefore = _cpToWinProb(cpBeforeMovingSide);
        const wpAfter  = _cpToWinProb(cpAfterMovingSide);
        const acc = wpAfter >= wpBefore ? 100 : Math.max(0, 100 * Math.exp(-4 * (wpBefore - wpAfter)));

        totals[m.side] += acc;
        counts[m.side]++;
    });

    return {
        white: counts.white > 0 ? totals.white / counts.white : 100,
        black: counts.black > 0 ? totals.black / counts.black : 100,
    };
}

function renderAccuracyBar(accuracies) {
    const existing = document.getElementById('accuracy-summary-bar');
    if (existing) existing.remove();

    function color(pct) {
        if (pct >= 90) return '#1baca6';
        if (pct >= 75) return '#95bb4a';
        if (pct >= 60) return '#81c995';
        if (pct >= 45) return '#f6c90e';
        if (pct >= 30) return '#f5a623';
        return '#e05252';
    }

    const wPct = accuracies.white.toFixed(1);
    const bPct = accuracies.black.toFixed(1);
    const wCol = color(accuracies.white);
    const bCol = color(accuracies.black);

    const bar = document.createElement('div');
    bar.id = 'accuracy-summary-bar';
    bar.style.cssText = `
        display:flex; justify-content:center; align-items:center; gap:30px;
        padding:14px 20px; background:#21201d; border-top:1px solid #3d3b37;
        flex-shrink:0;
    `;
    bar.innerHTML = `
        <div style="text-align:center;">
            <div style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">White Accuracy</div>
            <span style="display:inline-block;padding:6px 18px;border-radius:20px;font-size:16px;font-weight:bold;
                         background:${wCol}22;color:${wCol};border:1px solid ${wCol}55;">♙ ${wPct}%</span>
        </div>
        <div style="width:1px;height:40px;background:#3d3b37;"></div>
        <div style="text-align:center;">
            <div style="color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Black Accuracy</div>
            <span style="display:inline-block;padding:6px 18px;border-radius:20px;font-size:16px;font-weight:bold;
                         background:${bCol}22;color:${bCol};border:1px solid ${bCol}55;">♟ ${bPct}%</span>
        </div>
    `;

    const closeBtn = document.querySelector('#analysis-window .close-analysis');
    if (closeBtn) closeBtn.parentNode.insertBefore(bar, closeBtn);
}

// ── Trigger ───────────────────────────────────────────────────────────────────

async function triggerPostGameAnalysis() {
    injectAnalysisStyles();
    const btn = document.getElementById('analysis-trigger-btn');
    btn.innerText = "Analyzing...";
    btn.disabled = true;
    
    try {
        const results = await analyzeGame();
        renderAnalysisResults(results);
        renderAccuracyBar(computeAccuracies(results)); // ← accuracy bar
        btn.innerText = "Analysis Complete";
    } catch (e) {
        console.error(e);
        btn.innerText = "Error Analysing";
        btn.disabled = false;
    }
}

// 5. The Bridge
window.syncAnalysisButton = function() {
    const statusPanel = document.querySelector('.status-panel');
    let btn = document.getElementById('analysis-trigger-btn');
    if (game.game_over() && !btn) {
        btn = document.createElement('button');
        btn.id = 'analysis-trigger-btn';
        btn.innerHTML = '⟳ Analyse Game';
        btn.style = "width:100%; padding:10px; cursor:pointer; background:#1baca6; color:white; border:none; border-radius:4px; margin-top:10px; font-weight:bold;";
        btn.onclick = triggerPostGameAnalysis;
        statusPanel.appendChild(btn);
    } else if (!game.game_over() && btn) {
        btn.remove();
    }
};