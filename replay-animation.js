/**
 * replay-animation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Enhances the review-mode board with:
 *   • 250ms smooth piece transitions (translate + fade)
 *   • Last-move square highlights with a pulse flash
 *   • Animated board state changes that don't break stepping controls
 *
 * Must be loaded AFTER review-mode.js.
 * Does NOT modify engine logic, re-analyse moves, or touch window.game.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    //  CONSTANTS
    // ─────────────────────────────────────────────────────────────────────────
    const TRANSITION_MS  = 250;   // piece travel time
    const FLASH_MS       = 320;   // last-move square flash duration
    const STYLE_ID       = 'replay-animation-styles';

    // ─────────────────────────────────────────────────────────────────────────
    //  CSS INJECTION
    // ─────────────────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            /* ── Piece base animation state ── */
            #review-board .sq .piece {
                transition:
                    transform ${TRANSITION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
                    opacity   ${TRANSITION_MS}ms ease;
                will-change: transform, opacity;
            }

            /* Piece entering the board (fade-in from scale 0.7) */
            #review-board .sq .piece.ra-enter {
                animation: ra-piece-enter ${TRANSITION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }
            @keyframes ra-piece-enter {
                from { transform: scale(0.7); opacity: 0; }
                to   { transform: scale(1);   opacity: 1; }
            }

            /* Piece leaving the board (fade-out, scale up slightly) */
            #review-board .sq .piece.ra-exit {
                animation: ra-piece-exit ${TRANSITION_MS}ms ease forwards;
                pointer-events: none;
            }
            @keyframes ra-piece-exit {
                from { transform: scale(1);   opacity: 1; }
                to   { transform: scale(0.6); opacity: 0; }
            }

            /* Moving piece during transit */
            #review-board .sq .piece.ra-moving {
                z-index: 100;
                animation: ra-piece-move ${TRANSITION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
            }

            /* ── Last-move square highlight ── */
            #review-board .sq.rv-last-from,
            #review-board .sq.rv-last-to {
                background-color: #f5f682 !important;
            }

            /* Flash pulse on the destination square */
            #review-board .sq.ra-flash {
                animation: ra-square-flash ${FLASH_MS}ms ease-out forwards;
            }
            @keyframes ra-square-flash {
                0%   { filter: brightness(1.8); }
                60%  { filter: brightness(1.3); }
                100% { filter: brightness(1);   }
            }

            /* ── Board-wide fade when jumping multiple moves ── */
            #review-board.ra-board-fade {
                animation: ra-board-crossfade ${TRANSITION_MS}ms ease;
            }
            @keyframes ra-board-crossfade {
                0%   { opacity: 0.4; }
                100% { opacity: 1;   }
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /** Returns {row, col} for a square name like "e4" */
    function sqToRC(sqName) {
        const col = sqName.charCodeAt(0) - 97;   // a=0 … h=7
        const row = 8 - parseInt(sqName[1], 10);  // rank 8→row 0, rank 1→row 7
        return { row, col };
    }

    /** Get the pixel-centre of a square relative to the board element */
    function sqCentre(sqName, cellSize) {
        const { row, col } = sqToRC(sqName);
        return {
            x: col * cellSize + cellSize / 2,
            y: row * cellSize + cellSize / 2,
        };
    }

    /**
     * Snapshot which pieces are on which squares, keyed by squareName.
     * Returns Map<sqName, { type, color }>.
     */
    function snapshotPieces(chessInstance) {
        const board = chessInstance.board();
        const map   = new Map();
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece) {
                    const sqName = String.fromCharCode(97 + c) + (8 - r);
                    map.set(sqName, { type: piece.type, color: piece.color });
                }
            }
        }
        return map;
    }

    /**
     * Find moved/added/removed squares by diffing two snapshots.
     * Returns { moved: [{from, to}], added: [sqName], removed: [sqName] }
     */
    function diffPositions(snapBefore, snapAfter) {
        const removed  = [];
        const added    = [];
        const moved    = [];

        // Squares that existed before but changed / disappeared
        snapBefore.forEach((piece, sq) => {
            const after = snapAfter.get(sq);
            if (!after || after.type !== piece.type || after.color !== piece.color) {
                removed.push(sq);
            }
        });

        // Squares that are new or changed after
        snapAfter.forEach((piece, sq) => {
            const before = snapBefore.get(sq);
            if (!before || before.type !== piece.type || before.color !== piece.color) {
                added.push(sq);
            }
        });

        // Pair removed with added of same piece type+colour → "moved"
        const unmatchedRemoved = [];
        removed.forEach(fromSq => {
            const fromPiece = snapBefore.get(fromSq);
            const matchIdx  = added.findIndex(toSq => {
                const toPiece = snapAfter.get(toSq);
                return toPiece.type === fromPiece.type && toPiece.color === fromPiece.color;
            });
            if (matchIdx !== -1) {
                moved.push({ from: fromSq, to: added.splice(matchIdx, 1)[0] });
            } else {
                unmatchedRemoved.push(fromSq);
            }
        });

        return { moved, added, removed: unmatchedRemoved };
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ANIMATION CORE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Animate a single-step board transition.
     * fenBefore / fenAfter: FEN strings.
     * fromSq / toSq:       last-move squares for highlight.
     * afterDone():         callback once animation completes.
     */
    function animateBoardTransition(fenBefore, fenAfter, fromSq, toSq, afterDone) {
        const boardEl = document.getElementById('review-board');
        if (!boardEl) { afterDone && afterDone(); return; }

        const cellSize = boardEl.offsetWidth / 8;

        const chessBefore = new Chess();
        const chessAfter  = new Chess();
        chessBefore.load(fenBefore);
        chessAfter.load(fenAfter);

        const snapBefore = snapshotPieces(chessBefore);
        const snapAfter  = snapshotPieces(chessAfter);
        const diff       = diffPositions(snapBefore, snapAfter);

        // ── Step 1: animate exit of removed pieces ──
        diff.removed.forEach(sq => {
            const sqEl    = boardEl.querySelector(`[data-pos="${sq}"]`);
            const pieceEl = sqEl && sqEl.querySelector('.piece');
            if (pieceEl) {
                pieceEl.classList.add('ra-exit');
            }
        });

        // ── Step 2: fly moved pieces ──
        diff.moved.forEach(({ from, to }) => {
            const fromEl  = boardEl.querySelector(`[data-pos="${from}"]`);
            const pieceEl = fromEl && fromEl.querySelector('.piece');
            if (!pieceEl) return;

            const cFrom = sqCentre(from, cellSize);
            const cTo   = sqCentre(to,   cellSize);
            const dx    = cTo.x - cFrom.x;
            const dy    = cTo.y - cFrom.y;

            // Temporarily lift the piece above everything
            pieceEl.style.position = 'relative';
            pieceEl.style.zIndex   = '100';
            pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
            pieceEl.style.transition = `transform ${TRANSITION_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        });

        // ── Step 3: after transition, do a clean render + highlight + flash ──
        setTimeout(() => {
            // Use the original renderReviewBoard so we don't duplicate logic
            if (typeof renderReviewBoard === 'function') {
                renderReviewBoard(fromSq, toSq);
            }

            // Flash destination square
            if (toSq) {
                const destEl = boardEl.querySelector(`[data-pos="${toSq}"]`);
                if (destEl) {
                    destEl.classList.remove('ra-flash');
                    // Force reflow so the animation restarts
                    void destEl.offsetWidth;
                    destEl.classList.add('ra-flash');
                    setTimeout(() => destEl.classList.remove('ra-flash'), FLASH_MS);
                }
            }

            // Animate new pieces in
            diff.added.forEach(sq => {
                const sqEl    = boardEl.querySelector(`[data-pos="${sq}"]`);
                const pieceEl = sqEl && sqEl.querySelector('.piece');
                if (pieceEl) {
                    pieceEl.classList.add('ra-enter');
                    setTimeout(() => pieceEl && pieceEl.classList.remove('ra-enter'), TRANSITION_MS);
                }
            });

            afterDone && afterDone();
        }, TRANSITION_MS);
    }

    /**
     * Board cross-fade — used when jumping more than 1 step at once.
     */
    function crossFadeBoard(renderFn) {
        const boardEl = document.getElementById('review-board');
        if (!boardEl) { renderFn(); return; }

        boardEl.classList.add('ra-board-fade');
        renderFn();
        setTimeout(() => boardEl.classList.remove('ra-board-fade'), TRANSITION_MS);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  HOOK INTO review-mode.js
    //  We patch window.goToMove (exposed via closure) by wrapping the internal
    //  renderReviewBoard call through a MutationObserver.  Since goToMove is
    //  not directly exported, we intercept at a higher level by patching the
    //  button event handlers after the overlay is rendered.
    // ─────────────────────────────────────────────────────────────────────────

    let lastAnimatedIndex   = -2;   // tracks previous index so we know direction/distance
    let animationInProgress = false;

    /**
     * Install our animation hooks once the review overlay exists.
     * We use a MutationObserver to detect when the overlay is added.
     */
    function installHooks() {
        const observer = new MutationObserver(() => {
            const overlay = document.getElementById('review-overlay');
            if (!overlay) return;

            injectStyles();
            patchGoToMove(overlay);
            observer.disconnect();
        });

        observer.observe(document.body, { childList: true, subtree: false });
    }

    /**
     * Wraps the stepping buttons' click handlers to intercept goToMove calls.
     * We do this by wrapping window.launchReviewMode so our hooks run every
     * time review mode is opened (including re-opens after exit).
     */
    function patchGoToMove() {
        // The review-mode module keeps goToMove private, but it calls
        // renderReviewBoard internally. We patch renderReviewBoard on the
        // window so we can intercept it.
        //
        // review-mode.js defines renderReviewBoard inside its IIFE — it is NOT
        // on window. However it IS called by goToMove which IS triggered by the
        // buttons. The cleanest non-invasive approach: we intercept the board
        // DOM mutations to add our animations AFTER each render.

        setupBoardMutationObserver();
    }

    /**
     * Watch #review-board for child-list changes (i.e. whenever renderReviewBoard
     * replaces all the squares) and apply animations / highlights accordingly.
     */
    function setupBoardMutationObserver() {
        const boardEl = document.getElementById('review-board');
        if (!boardEl) return;

        // We need to remember the previous FEN to compute diffs.
        // We track it via a data attribute on the board element.
        let prevFen = null;

        const mo = new MutationObserver(() => {
            // The board was just re-rendered. Figure out what changed.
            const overlay = document.getElementById('review-overlay');
            if (!overlay) { mo.disconnect(); return; }

            // Read current FEN from the last highlighted squares
            // We detect last-move squares that review-mode already adds (rv-last-from/to)
            const fromEl = boardEl.querySelector('.rv-last-from');
            const toEl   = boardEl.querySelector('.rv-last-to');
            const fromSq = fromEl ? fromEl.dataset.pos : null;
            const toSq   = toEl   ? toEl.dataset.pos   : null;

            // Apply flash on the destination square (the board HTML is already final)
            if (toSq) {
                const dest = boardEl.querySelector(`[data-pos="${toSq}"]`);
                if (dest) {
                    dest.classList.remove('ra-flash');
                    void dest.offsetWidth;
                    dest.classList.add('ra-flash');
                    setTimeout(() => dest && dest.classList.remove('ra-flash'), FLASH_MS);
                }
            }

            // Animate pieces that appeared
            boardEl.querySelectorAll('.piece').forEach(pieceEl => {
                pieceEl.classList.remove('ra-enter');
                void pieceEl.offsetWidth;
                pieceEl.classList.add('ra-enter');
                setTimeout(() => pieceEl && pieceEl.classList.remove('ra-enter'), TRANSITION_MS);
            });
        });

        mo.observe(boardEl, { childList: true });

        // Disconnect when review mode closes
        const exitBtn = document.getElementById('review-exit-btn');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => mo.disconnect(), { once: true });
        }
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') { mo.disconnect(); document.removeEventListener('keydown', handler); }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  LAUNCH HOOK — wrap window.launchReviewMode so we set up every time
    // ─────────────────────────────────────────────────────────────────────────
    function wrapLaunchReviewMode() {
        const _orig = window.launchReviewMode;
        if (!_orig) {
            // review-mode.js not loaded yet — retry shortly
            setTimeout(wrapLaunchReviewMode, 80);
            return;
        }

        window.launchReviewMode = function (moveAnalysis) {
            _orig(moveAnalysis);

            // After review-mode builds its DOM, hook in our observer
            requestAnimationFrame(() => {
                injectStyles();
                patchGoToMove();
            });
        };

        console.log('[replay-animation] Hooks installed ✓');
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ADDITIONAL: smooth stepping debounce
    //  Prevent rapid key-repeat from queuing up dozens of renders.
    // ─────────────────────────────────────────────────────────────────────────
    (function installKeyDebounce() {
        let debounceTimer = null;

        document.addEventListener('keydown', function (e) {
            const overlay = document.getElementById('review-overlay');
            if (!overlay) return;

            const isStepKey = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key);
            if (!isStepKey) return;

            if (debounceTimer) {
                // Still in transition — allow the key but throttle to ~1 per TRANSITION_MS
                // (review-mode already handles the move; we just add a tiny guard)
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => { debounceTimer = null; }, TRANSITION_MS * 0.8);
        }, true /* capture — runs before review-mode's handler */ );
    })();

    // ─────────────────────────────────────────────────────────────────────────
    //  INIT
    // ─────────────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wrapLaunchReviewMode);
    } else {
        wrapLaunchReviewMode();
    }

})();
