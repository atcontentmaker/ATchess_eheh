/**
 * REVIEW MODE MODULE
 * Split-screen post-game analysis viewer.
 * Non-destructive — does not touch game, stockfishWorker, or any gameplay logic.
 * Activated via window.launchReviewMode(moveAnalysis) after analyzeGame() completes.
 */

(() => {
    // ─────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────
    let reviewMoves   = [];   // moveAnalysis array passed in from chess-analysis.js
    let replayGame    = null; // isolated Chess() instance — never touches window.game
    let currentIndex  = -1;  // -1 = starting position, 0..n-1 = after move n
    let fenHistory    = [];   // FEN snapshots: fenHistory[0]=start, fenHistory[i+1]=after move i

    // ─────────────────────────────────────────────
    //  STYLES
    // ─────────────────────────────────────────────
    function injectReviewStyles() {
        if (document.getElementById('review-mode-styles')) return;
        const style = document.createElement('style');
        style.id = 'review-mode-styles';
        style.textContent = `
            /* ── Overlay shell ── */
            #review-overlay {
                position: fixed; inset: 0;
                background: #1a1917;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: #d4cfc9;
            }

            /* ── Top bar ── */
            #review-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 20px;
                background: #21201d;
                border-bottom: 1px solid #3a3835;
                flex-shrink: 0;
            }
            #review-topbar h2 {
                margin: 0;
                font-size: 15px;
                font-weight: 700;
                color: #1baca6;
                letter-spacing: 0.08em;
                text-transform: uppercase;
            }
            #review-exit-btn {
                padding: 7px 18px;
                background: transparent;
                border: 1px solid #3a3835;
                color: #d4cfc9;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                transition: background 0.15s, border-color 0.15s;
            }
            #review-exit-btn:hover { background: #3a3835; border-color: #555; }

            /* ── Main body ── */
            #review-body {
                display: grid;
                grid-template-columns: 1fr 380px;
                flex: 1;
                overflow: hidden;
            }

            /* ── LEFT: board column ── */
            #review-left {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                gap: 16px;
                background: #1a1917;
            }

            /* Eval bar + board wrapper */
            #review-board-area {
                display: flex;
                align-items: stretch;
                gap: 10px;
            }

            /* Vertical eval bar */
            #eval-bar-wrap {
                width: 18px;
                border-radius: 4px;
                overflow: hidden;
                background: #262421;
                display: flex;
                flex-direction: column;
                position: relative;
                border: 1px solid #3a3835;
            }
            #eval-bar-white {
                background: #ebecd0;
                transition: height 0.4s cubic-bezier(0.4,0,0.2,1);
                width: 100%;
            }
            #eval-bar-black {
                background: #403d39;
                flex: 1;
            }
            #eval-bar-label {
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 9px;
                color: #777;
                font-weight: 700;
                writing-mode: vertical-rl;
                letter-spacing: 0.05em;
                pointer-events: none;
            }

            /* Review board */
            #review-board-wrap {
                position: relative;
            }
            #review-board {
                display: grid;
                grid-template-columns: repeat(8, 1fr);
                grid-template-rows: repeat(8, 1fr);
                width: 480px;
                height: 480px;
                user-select: none;
                border-radius: 2px;
                overflow: hidden;
                box-shadow: 0 8px 30px rgba(0,0,0,0.5);
            }
            #review-board .sq {
                display: flex; justify-content: center; align-items: center;
                position: relative; font-size: 36px;
                cursor: default;
            }
            #review-board .sq.light { background-color: #ebecd0; }
            #review-board .sq.dark  { background-color: #779556; }
            #review-board .sq.rv-last-from { background-color: #f5f682 !important; }
            #review-board .sq.rv-last-to   { background-color: #f5f682 !important; }
            #review-board .sq.rv-best-from { outline: 2px inset rgba(27,172,166,0.7); }
            #review-board .sq.rv-best-to   { outline: 2px inset rgba(27,172,166,0.7); }

            /* Board coordinate labels */
            .rv-coord-file, .rv-coord-rank {
                position: absolute;
                font-size: 10px;
                font-weight: 700;
                opacity: 0.5;
                pointer-events: none;
                line-height: 1;
            }
            .rv-coord-file { bottom: 2px; right: 3px; }
            .rv-coord-rank { top: 2px; left: 3px; }

            /* SVG arrow overlay */
            #review-arrow-svg {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                pointer-events: none;
                z-index: 20;
            }

            /* ── Playback controls ── */
            #review-controls {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .rv-btn {
                width: 40px; height: 40px;
                background: #2b2925;
                border: 1px solid #3a3835;
                border-radius: 4px;
                color: #d4cfc9;
                font-size: 16px;
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: background 0.15s;
            }
            .rv-btn:hover:not(:disabled) { background: #3a3835; }
            .rv-btn:disabled { opacity: 0.3; cursor: default; }
            #rv-move-counter {
                font-size: 13px; color: #888; min-width: 80px; text-align: center;
            }

            /* ── RIGHT: analysis panel ── */
            #review-right {
                display: flex;
                flex-direction: column;
                background: #21201d;
                border-left: 1px solid #3a3835;
                overflow: hidden;
            }

            /* Eval graph */
            #review-graph-wrap {
                padding: 12px 14px 6px;
                border-bottom: 1px solid #3a3835;
                flex-shrink: 0;
            }
            #review-graph-title {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: #555;
                margin-bottom: 6px;
            }
            #review-eval-canvas {
                width: 100%;
                height: 90px;
                display: block;
                border-radius: 3px;
                cursor: pointer;
            }

            /* Current move classification card */
            #review-move-card {
                padding: 12px 16px;
                border-bottom: 1px solid #3a3835;
                display: flex;
                align-items: center;
                gap: 14px;
                flex-shrink: 0;
                min-height: 64px;
            }
            #rv-badge {
                padding: 5px 12px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                white-space: nowrap;
            }
            #rv-move-san {
                font-size: 22px;
                font-weight: 700;
                color: white;
                font-family: monospace;
            }
            #rv-eval-change {
                font-size: 12px;
                color: #888;
                margin-top: 2px;
            }
            #rv-best-move-hint {
                margin-left: auto;
                font-size: 11px;
                color: #555;
                text-align: right;
            }

            /* Move list table */
            #review-move-list {
                flex: 1;
                overflow-y: auto;
                padding: 4px 0;
            }
            #review-move-list::-webkit-scrollbar { width: 4px; }
            #review-move-list::-webkit-scrollbar-thumb { background: #3a3835; border-radius: 2px; }

            .rv-move-pair {
                display: grid;
                grid-template-columns: 36px 1fr 1fr;
                align-items: stretch;
                border-bottom: 1px solid #2a2825;
            }
            .rv-move-num {
                padding: 8px 6px;
                font-size: 12px;
                color: #555;
                text-align: center;
                font-weight: 700;
                background: #1e1d1b;
                display: flex; align-items: center; justify-content: center;
            }
            .rv-move-cell {
                padding: 7px 10px;
                font-size: 13px;
                font-family: monospace;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: background 0.1s;
                border-left: 1px solid #2a2825;
            }
            .rv-move-cell:hover { background: #2b2925; }
            .rv-move-cell.rv-active {
                background: #2b3a30;
                border-left: 2px solid #1baca6;
            }
            .rv-move-cell .rv-cell-san { color: #e8e4de; font-weight: 600; }
            .rv-move-cell .rv-cell-icon { font-size: 11px; }
            .rv-move-cell .rv-cell-eval { margin-left: auto; font-size: 11px; color: #666; }

            /* Accuracy footer */
            #review-accuracy-bar {
                padding: 12px 16px;
                border-top: 1px solid #3a3835;
                display: flex;
                gap: 20px;
                flex-shrink: 0;
            }
            .rv-acc-side {
                flex: 1;
            }
            .rv-acc-label { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
            .rv-acc-stats { display: flex; gap: 8px; flex-wrap: wrap; }
            .rv-acc-chip {
                padding: 2px 7px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 700;
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────
    //  BOARD RENDERING (isolated, reads replayGame)
    // ─────────────────────────────────────────────
    const reviewPieceIcons = {
        p: 'fa-chess-pawn', r: 'fa-chess-rook', n: 'fa-chess-knight',
        b: 'fa-chess-bishop', q: 'fa-chess-queen', k: 'fa-chess-king'
    };

    function renderReviewBoard(highlightFrom, highlightTo) {
        const boardEl = document.getElementById('review-board');
        if (!boardEl) return;
        boardEl.innerHTML = '';

        const boardState = replayGame.board();
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const sq = document.createElement('div');
                const sqName = String.fromCharCode(97 + j) + (8 - i);
                const isDark = (i + j) % 2 !== 0;
                sq.classList.add('sq', isDark ? 'dark' : 'light');
                sq.dataset.pos = sqName;

                // Coordinate labels
                if (j === 7) {
                    const rankLbl = document.createElement('span');
                    rankLbl.className = 'rv-coord-rank';
                    rankLbl.textContent = 8 - i;
                    sq.appendChild(rankLbl);
                }
                if (i === 7) {
                    const fileLbl = document.createElement('span');
                    fileLbl.className = 'rv-coord-file';
                    fileLbl.textContent = String.fromCharCode(97 + j);
                    sq.appendChild(fileLbl);
                }

                if (highlightFrom === sqName) sq.classList.add('rv-last-from');
                if (highlightTo   === sqName) sq.classList.add('rv-last-to');

                const piece = boardState[i][j];
                if (piece) {
                    const icon = document.createElement('i');
                    icon.classList.add('fa-solid', reviewPieceIcons[piece.type], 'piece');
                    icon.style.color = piece.color === 'w' ? '#fff' : '#111';
                    icon.style.pointerEvents = 'none';
                    sq.appendChild(icon);
                }

                boardEl.appendChild(sq);
            }
        }
    }

    // ─────────────────────────────────────────────
    //  BEST MOVE ARROW (SVG overlay)
    // ─────────────────────────────────────────────
    function squareToXY(sqName, boardPx) {
        // Returns center {x, y} of a square given board pixel size
        const file = sqName.charCodeAt(0) - 97; // a=0..h=7
        const rank = 8 - parseInt(sqName[1]);    // rank 8=row0, rank 1=row7
        const cellSize = boardPx / 8;
        return {
            x: file * cellSize + cellSize / 2,
            y: rank * cellSize + cellSize / 2
        };
    }

    function drawBestMoveArrow(fromSq, toSq) {
        const svg = document.getElementById('review-arrow-svg');
        if (!svg || !fromSq || !toSq) { if (svg) svg.innerHTML = ''; return; }

        const boardPx = 480;
        const p1 = squareToXY(fromSq, boardPx);
        const p2 = squareToXY(toSq, boardPx);

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / len;
        const uy = dy / len;
        const shorten = 24;

        const x1 = p1.x + ux * 12;
        const y1 = p1.y + uy * 12;
        const x2 = p2.x - ux * shorten;
        const y2 = p2.y - uy * shorten;

        svg.innerHTML = `
            <defs>
                <marker id="rv-arrowhead" markerWidth="6" markerHeight="6"
                        refX="3" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="rgba(27,172,166,0.85)"/>
                </marker>
            </defs>
            <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                  stroke="rgba(27,172,166,0.75)" stroke-width="8"
                  stroke-linecap="round"
                  marker-end="url(#rv-arrowhead)"/>
        `;
    }

    // ─────────────────────────────────────────────
    //  EVAL BAR
    // ─────────────────────────────────────────────
    function updateEvalBar(evalScore) {
        const barWhite = document.getElementById('eval-bar-white');
        if (!barWhite) return;

        // Clamp eval to [-10, 10], map to [0%, 100%] white height
        const clamped = Math.max(-10, Math.min(10, evalScore));
        const whitePct = ((clamped + 10) / 20) * 100;
        barWhite.style.height = whitePct + '%';
    }

    // ─────────────────────────────────────────────
    //  EVAL GRAPH (canvas)
    // ─────────────────────────────────────────────
    function renderEvalGraph(highlightIndex) {
        const canvas = document.getElementById('review-eval-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width  = canvas.offsetWidth;
        const H = canvas.height = 90;

        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#1a1917';
        ctx.fillRect(0, 0, W, H);

        // Zero line
        ctx.strokeStyle = '#3a3835';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        if (reviewMoves.length === 0) return;

        const evals = reviewMoves.map(m => Math.max(-10, Math.min(10, m.evalAfter)));
        const stepX = W / (evals.length + 1);

        function toY(e) { return H / 2 - (e / 10) * (H / 2 - 6); }

        // Fill area above zero (white advantage)
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        for (let i = 0; i < evals.length; i++) {
            ctx.lineTo((i + 1) * stepX, toY(evals[i]));
        }
        ctx.lineTo(evals.length * stepX, H / 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(235,236,208,0.18)';
        ctx.fill();

        // Fill area below zero (black advantage)
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        for (let i = 0; i < evals.length; i++) {
            ctx.lineTo((i + 1) * stepX, toY(evals[i]));
        }
        ctx.lineTo(evals.length * stepX, H / 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(64,61,57,0.35)';
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        for (let i = 0; i < evals.length; i++) {
            ctx.lineTo((i + 1) * stepX, toY(evals[i]));
        }
        ctx.strokeStyle = '#1baca6';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Highlighted point
        if (highlightIndex >= 0 && highlightIndex < evals.length) {
            const hx = (highlightIndex + 1) * stepX;
            const hy = toY(evals[highlightIndex]);
            ctx.beginPath();
            ctx.arc(hx, hy, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#1baca6';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Clickable — jump to move
        canvas.onclick = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            let closest = Math.round(clickX / stepX) - 1;
            closest = Math.max(-1, Math.min(evals.length - 1, closest));
            goToMove(closest);
        };
    }

    // ─────────────────────────────────────────────
    //  MOVE LIST PANEL
    // ─────────────────────────────────────────────
    function renderMoveList() {
        const container = document.getElementById('review-move-list');
        if (!container) return;
        container.innerHTML = '';

        // Pair moves into rows (white + black per row)
        for (let i = 0; i < reviewMoves.length; i += 2) {
            const moveNum = reviewMoves[i].moveNumber;
            const row = document.createElement('div');
            row.className = 'rv-move-pair';

            const numCell = document.createElement('div');
            numCell.className = 'rv-move-num';
            numCell.textContent = moveNum;
            row.appendChild(numCell);

            [i, i + 1].forEach(idx => {
                if (idx >= reviewMoves.length) {
                    const empty = document.createElement('div');
                    empty.className = 'rv-move-cell';
                    row.appendChild(empty);
                    return;
                }
                const m = reviewMoves[idx];
                const meta = (typeof CLASSIFICATION_META !== 'undefined' && CLASSIFICATION_META[m.type])
                    ? CLASSIFICATION_META[m.type]
                    : { emoji: '', color: '#666' };

                const cell = document.createElement('div');
                cell.className = 'rv-move-cell';
                cell.dataset.moveIdx = idx;
                cell.innerHTML = `
                    <span class="rv-cell-icon" style="color:${meta.color}">${meta.emoji}</span>
                    <span class="rv-cell-san">${m.move}</span>
                    <span class="rv-cell-eval">${m.evalAfter > 0 ? '+' : ''}${m.evalAfter.toFixed(1)}</span>
                `;
                cell.addEventListener('click', () => goToMove(idx));
                row.appendChild(cell);
            });

            container.appendChild(row);
        }
    }

    function highlightMoveInList(index) {
        document.querySelectorAll('.rv-move-cell').forEach(cell => {
            cell.classList.remove('rv-active');
        });
        if (index >= 0) {
            const active = document.querySelector(`.rv-move-cell[data-move-idx="${index}"]`);
            if (active) {
                active.classList.add('rv-active');
                active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    // ─────────────────────────────────────────────
    //  MOVE CARD (current classification display)
    // ─────────────────────────────────────────────
    function updateMoveCard(index) {
        const badge    = document.getElementById('rv-badge');
        const sanEl    = document.getElementById('rv-move-san');
        const evalEl   = document.getElementById('rv-eval-change');
        const hintEl   = document.getElementById('rv-best-move-hint');
        const counterEl = document.getElementById('rv-move-counter');

        if (index < 0) {
            badge.textContent = '';
            badge.style.background = 'transparent';
            sanEl.textContent = '—';
            evalEl.textContent = 'Starting position';
            hintEl.textContent = '';
            counterEl.textContent = 'Start';
            return;
        }

        const m = reviewMoves[index];
        const meta = (typeof CLASSIFICATION_META !== 'undefined' && CLASSIFICATION_META[m.type])
            ? CLASSIFICATION_META[m.type]
            : { label: m.type, emoji: '', color: '#888' };

        badge.textContent = `${meta.emoji} ${meta.label}`;
        badge.style.background = meta.color + '22';
        badge.style.color = meta.color;
        badge.style.border = `1px solid ${meta.color}55`;

        sanEl.textContent = `${m.moveNumber}${m.side === 'white' ? '.' : '...'} ${m.move}`;

        const swingSign = m.swing >= 0 ? '+' : '';
        const swingColor = m.swing < -0.5 ? '#e05252' : m.swing > 0.3 ? '#81c995' : '#888';
        evalEl.innerHTML = `Eval: <span style="color:#aaa">${m.evalAfter > 0 ? '+' : ''}${m.evalAfter.toFixed(2)}</span>
            &nbsp;·&nbsp; Swing: <span style="color:${swingColor}">${swingSign}${m.swing.toFixed(2)}</span>`;

        hintEl.innerHTML = m.bestMove && m.move !== m.bestMove
            ? `Best: <span style="color:#1baca6; font-family:monospace">${m.bestMove}</span>`
            : '';

        const total = reviewMoves.length;
        counterEl.textContent = `${index + 1} / ${total}`;
    }

    // ─────────────────────────────────────────────
    //  ACCURACY FOOTER
    // ─────────────────────────────────────────────
    function computeAccuracyPct(moves) {
        function cpToWp(cp) {
            return 1 / (1 + Math.pow(10, -Math.max(-1000, Math.min(1000, cp)) / 400));
        }
        const totals = { white: 0, black: 0 };
        const counts = { white: 0, black: 0 };
        moves.forEach(m => {
            const cpAfter  = m.evalAfter * 100 * (m.side === 'white' ? 1 : -1);
            const cpBefore = cpAfter - (m.swing * 100);
            const wpB = cpToWp(cpBefore), wpA = cpToWp(cpAfter);
            totals[m.side] += wpA >= wpB ? 100 : Math.max(0, 100 * Math.exp(-4 * (wpB - wpA)));
            counts[m.side]++;
        });
        return {
            white: counts.white > 0 ? totals.white / counts.white : 100,
            black: counts.black > 0 ? totals.black / counts.black : 100,
        };
    }

    function renderAccuracyFooter() {
        const container = document.getElementById('review-accuracy-bar');
        if (!container) return;

        const sides = { white: { brilliant:0, great:0, best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0, missedWin:0 },
                        black: { brilliant:0, great:0, best:0, excellent:0, good:0, inaccuracy:0, mistake:0, blunder:0, missedWin:0 } };

        reviewMoves.forEach(m => { if (sides[m.side] && m.type in sides[m.side]) sides[m.side][m.type]++; });

        const accuracies = computeAccuracyPct(reviewMoves);

        function accColor(pct) {
            if (pct >= 90) return '#1baca6';
            if (pct >= 75) return '#95bb4a';
            if (pct >= 60) return '#81c995';
            if (pct >= 45) return '#f6c90e';
            if (pct >= 30) return '#f5a623';
            return '#e05252';
        }

        container.innerHTML = '';
        ['white', 'black'].forEach(side => {
            const div = document.createElement('div');
            div.className = 'rv-acc-side';
            const pct = accuracies[side].toFixed(1);
            const col = accColor(accuracies[side]);
            const icon = side === 'white' ? '♙' : '♟';
            div.innerHTML = `
                <div class="rv-acc-label" style="display:flex;align-items:center;justify-content:space-between;">
                    <span>${side}</span>
                    <span style="font-size:13px;font-weight:700;color:${col};
                                 background:${col}22;border:1px solid ${col}44;
                                 padding:1px 8px;border-radius:10px;">
                        ${icon} ${pct}%
                    </span>
                </div>
                <div class="rv-acc-stats"></div>`;
            const statsDiv = div.querySelector('.rv-acc-stats');
            const stats = sides[side];
            Object.entries(stats).forEach(([type, count]) => {
                if (count === 0) return;
                const meta = (typeof CLASSIFICATION_META !== 'undefined') ? CLASSIFICATION_META[type] : null;
                const color = meta ? meta.color : '#888';
                const emoji = meta ? meta.emoji : '';
                const chip = document.createElement('span');
                chip.className = 'rv-acc-chip';
                chip.style.background = color + '22';
                chip.style.color = color;
                chip.style.border = `1px solid ${color}44`;
                chip.textContent = `${emoji} ${count}`;
                chip.title = `${count} ${type}`;
                statsDiv.appendChild(chip);
            });
            container.appendChild(div);
        });
    }

    // ─────────────────────────────────────────────
    //  CORE: goToMove
    // ─────────────────────────────────────────────
    function goToMove(index) {
        // Clamp
        index = Math.max(-1, Math.min(reviewMoves.length - 1, index));
        currentIndex = index;

        // Restore position from FEN snapshot
        replayGame.load(fenHistory[index + 1]); // fenHistory[0]=start, [i+1]=after move i

        // Determine squares to highlight
        let fromSq = null, toSq = null;
        let bestFrom = null, bestTo = null;
        let evalScore = 0;

        if (index >= 0) {
            // Get the verbose move details to find from/to squares
            // We replay up to index from start to find the move object
            const tempG = new Chess();
            for (let k = 0; k <= index; k++) {
                const moveResult = tempG.move(reviewMoves[k].move);
                if (k === index && moveResult) {
                    fromSq = moveResult.from;
                    toSq   = moveResult.to;
                }
            }

            const m = reviewMoves[index];
            evalScore = m.evalAfter;

            // Parse best move UCI string (e.g. "e2e4")
            if (m.bestMove && m.bestMove.length >= 4) {
                bestFrom = m.bestMove.substring(0, 2);
                bestTo   = m.bestMove.substring(2, 4);
            }
        }

        // Render
        renderReviewBoard(fromSq, toSq);
        drawBestMoveArrow(bestFrom, bestTo);
        updateEvalBar(evalScore);
        renderEvalGraph(index);
        updateMoveCard(index);
        highlightMoveInList(index);

        // ── Sounds ──────────────────────────────────────────────────────────────
        if (index >= 0 && window.ChessSounds) {
            try {
                const snapBefore = new Chess();
                snapBefore.load(fenHistory[index]);
                const result = snapBefore.move(reviewMoves[index].move);
                if (result) {
                    const f = result.flags || '';
                    let soundKey = 'move';
                    if (snapBefore.in_checkmate())               soundKey = 'checkmate';
                    else if (snapBefore.in_check())              soundKey = 'check';
                    else if (f.includes('k') || f.includes('q')) soundKey = 'castle';
                    else if (f.includes('c') || f.includes('e')) soundKey = 'capture';
                    window.ChessSounds.play(soundKey);
                }
            } catch (e) {
                console.warn('[review-mode sounds]', e);
            }
        }
        // ────────────────────────────────────────────────────────────────────────

        // Update nav buttons
        const prevBtn = document.getElementById('rv-prev-btn');
        const nextBtn = document.getElementById('rv-next-btn');
        const firstBtn = document.getElementById('rv-first-btn');
        const lastBtn = document.getElementById('rv-last-btn');
        if (prevBtn) prevBtn.disabled  = index <= -1;
        if (nextBtn) nextBtn.disabled  = index >= reviewMoves.length - 1;
        if (firstBtn) firstBtn.disabled = index <= -1;
        if (lastBtn) lastBtn.disabled  = index >= reviewMoves.length - 1;
    }

    function nextMove() { goToMove(currentIndex + 1); }
    function prevMove() { goToMove(currentIndex - 1); }

    // ─────────────────────────────────────────────
    //  LAYOUT BUILDER
    // ─────────────────────────────────────────────
    function renderSplitLayout() {
        const overlay = document.createElement('div');
        overlay.id = 'review-overlay';
        overlay.innerHTML = `
            <!-- Top bar -->
            <div id="review-topbar">
                <h2>⟳ Game Review</h2>
                <div style="display:flex; gap:10px; align-items:center;">
                    <span style="font-size:12px; color:#555;">${reviewMoves.length} moves analysed</span>
                    <button id="review-exit-btn">✕ Exit Review</button>
                </div>
            </div>

            <!-- Body -->
            <div id="review-body">

                <!-- LEFT: board side -->
                <div id="review-left">
                    <div id="review-board-area">
                        <!-- Vertical eval bar -->
                        <div id="eval-bar-wrap">
                            <div id="eval-bar-white" style="height:50%"></div>
                            <div id="eval-bar-black"></div>
                        </div>

                        <!-- Board + SVG arrow layer -->
                        <div id="review-board-wrap">
                            <div id="review-board"></div>
                            <svg id="review-arrow-svg" viewBox="0 0 480 480" xmlns="http://www.w3.org/2000/svg"></svg>
                        </div>
                    </div>

                    <!-- Controls -->
                    <div id="review-controls">
                        <button class="rv-btn" id="rv-first-btn" title="First move">⏮</button>
                        <button class="rv-btn" id="rv-prev-btn"  title="Previous move">◀</button>
                        <span id="rv-move-counter">Start</span>
                        <button class="rv-btn" id="rv-next-btn"  title="Next move">▶</button>
                        <button class="rv-btn" id="rv-last-btn"  title="Last move">⏭</button>
                    </div>
                </div>

                <!-- RIGHT: analysis panel -->
                <div id="review-right">
                    <!-- Eval graph -->
                    <div id="review-graph-wrap">
                        <div id="review-graph-title">Evaluation Graph</div>
                        <canvas id="review-eval-canvas"></canvas>
                    </div>

                    <!-- Move classification card -->
                    <div id="review-move-card">
                        <span id="rv-badge"></span>
                        <div>
                            <div id="rv-move-san">—</div>
                            <div id="rv-eval-change">Starting position</div>
                        </div>
                        <span id="rv-best-move-hint"></span>
                    </div>

                    <!-- Scrollable move list -->
                    <div id="review-move-list"></div>

                    <!-- Accuracy footer -->
                    <div id="review-accuracy-bar"></div>
                </div>

            </div>
        `;

        document.body.appendChild(overlay);

        // Wire up buttons
        document.getElementById('review-exit-btn').addEventListener('click', exitReviewMode);
        document.getElementById('rv-first-btn').addEventListener('click', () => goToMove(-1));
        document.getElementById('rv-prev-btn').addEventListener('click', prevMove);
        document.getElementById('rv-next-btn').addEventListener('click', nextMove);
        document.getElementById('rv-last-btn').addEventListener('click', () => goToMove(reviewMoves.length - 1));

        // Keyboard navigation
        overlay._keyHandler = (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); nextMove(); }
            if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); prevMove(); }
            if (e.key === 'Home')  { e.preventDefault(); goToMove(-1); }
            if (e.key === 'End')   { e.preventDefault(); goToMove(reviewMoves.length - 1); }
            if (e.key === 'Escape') { exitReviewMode(); }
        };
        document.addEventListener('keydown', overlay._keyHandler);
    }

    // ─────────────────────────────────────────────
    //  INIT & EXIT
    // ─────────────────────────────────────────────
    function initReviewMode(moveAnalysis) {
        if (!moveAnalysis || moveAnalysis.length === 0) {
            console.warn('[ReviewMode] No move analysis data provided.');
            return;
        }

        reviewMoves  = moveAnalysis;
        currentIndex = -1;

        // Build isolated replay Chess instance + FEN history
        replayGame = new Chess();
        fenHistory  = [replayGame.fen()]; // index 0 = starting position

        for (const m of reviewMoves) {
            replayGame.move(m.move);
            fenHistory.push(replayGame.fen());
        }
        replayGame.load(fenHistory[0]); // reset to start

        // Inject styles, build layout, populate panels
        injectReviewStyles();
        renderSplitLayout();
        renderMoveList();
        renderAccuracyFooter();

        // Start at beginning
        goToMove(-1);
    }

    function exitReviewMode() {
        const overlay = document.getElementById('review-overlay');
        if (overlay) {
            document.removeEventListener('keydown', overlay._keyHandler);
            overlay.remove();
        }
        reviewMoves  = [];
        replayGame   = null;
        fenHistory   = [];
        currentIndex = -1;
    }

    // ─────────────────────────────────────────────
    //  PUBLIC API
    // ─────────────────────────────────────────────
    window.launchReviewMode = initReviewMode;
    window.exitReviewMode   = exitReviewMode;

    // ─────────────────────────────────────────────
    //  HOOK INTO chess-analysis.js
    //  After analyzeGame() finishes, also open review mode.
    //  We patch renderAnalysisResults non-destructively.
    // ─────────────────────────────────────────────
    const _origTrigger = window.triggerPostGameAnalysis;

    // We patch at the bottom of the chain: after results come in,
    // change the analysis button to also offer Review Mode.
    window.triggerPostGameAnalysis = async function () {
        injectReviewStyles?.(); // from chess-analysis.js if present
        const btn = document.getElementById('analysis-trigger-btn');
        if (btn) { btn.innerText = 'Analyzing...'; btn.disabled = true; }

        try {
            // analyzeGame is defined in chess-analysis.js scope — call original pipeline
            const results = await analyzeGame();

            // Show the existing modal overlay
            if (typeof renderAnalysisResults === 'function') {
                renderAnalysisResults(results);
            }

            // Add a "Review Mode" button inside the analysis overlay
            const overlay = document.getElementById('analysis-overlay');
            if (overlay) {
                const reviewBtn = document.createElement('button');
                reviewBtn.textContent = '🎬 Open Review Mode';
                reviewBtn.style.cssText = 'width:100%; padding:12px; cursor:pointer; background:#1baca6; color:white; border:none; font-weight:bold; font-size:14px;';
                reviewBtn.onclick = () => {
                    overlay.remove();
                    window.launchReviewMode(results);
                };
                // Insert before the close button
                const closeBtn = overlay.querySelector('.close-analysis');
                if (closeBtn) overlay.querySelector('#analysis-window').insertBefore(reviewBtn, closeBtn);
                else overlay.querySelector('#analysis-window').appendChild(reviewBtn);
            }

            if (btn) btn.innerText = 'Analysis Complete ✓';
        } catch (e) {
            console.error('[ReviewMode]', e);
            if (btn) { btn.innerText = 'Error Analysing'; btn.disabled = false; }
        }
    };

})();
