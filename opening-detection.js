/**
 * opening-detection.js
 * Detects chess openings from move history using a local ECO JSON mapping.
 * Displays opening name above the board, updating live after each move.
 *
 * Dependencies: chess.js `game` instance must be in global scope.
 * No external APIs. No interference with engine or analysis code.
 */

(function () {
    'use strict';

    // ── Config ────────────────────────────────────────────────────────────────
    const ECO_JSON_PATH = 'eco-openings.json';
    const MIN_MOVES     = 2;   // start matching from move 2 (ply 2)
    const DISPLAY_ID    = 'opening-name-display';

    // ── State ─────────────────────────────────────────────────────────────────
    let ecoDatabase  = [];
    let loaded       = false;

    // ── Load ECO database ────────────────────────────────────────────────────
    async function loadECO() {
        if (loaded) return;
        try {
            const res = await fetch(ECO_JSON_PATH);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw = await res.json();

            // Pre-process: normalise move strings into arrays for fast comparison
            ecoDatabase = raw
                .map(entry => ({
                    eco:    entry.eco,
                    name:   entry.name,
                    moves:  entry.moves.trim().split(/\s+/),
                }))
                // Sort by move depth descending so the longest (most specific) match wins
                .sort((a, b) => b.moves.length - a.moves.length);

            loaded = true;
            console.log(`[opening-detection] Loaded ${ecoDatabase.length} openings ✓`);
        } catch (err) {
            console.error('[opening-detection] Failed to load ECO JSON:', err);
        }
    }

    // ── Matching logic ────────────────────────────────────────────────────────

    /**
     * Strips annotations (+, #, !, ?) from a SAN move string so it can be
     * compared against the clean strings stored in the ECO database.
     */
    function cleanSAN(san) {
        return san.replace(/[+#!?]/g, '');
    }

    /**
     * Given a list of played SAN moves, return the best matching ECO entry
     * (longest prefix match) or null if none match.
     */
    function findOpening(playedMoves) {
        const played = playedMoves.map(cleanSAN);

        for (const entry of ecoDatabase) {         // already sorted longest-first
            const db = entry.moves;
            if (db.length > played.length) continue; // need at least as many moves

            let match = true;
            for (let i = 0; i < db.length; i++) {
                if (played[i] !== db[i]) { match = false; break; }
            }
            if (match) return entry;
        }
        return null;
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    function injectDisplayBar() {
        if (document.getElementById(DISPLAY_ID)) return;

        const board = document.getElementById('board');
        if (!board) { console.warn('[opening-detection] #board not found'); return; }

        const bar = document.createElement('div');
        bar.id = DISPLAY_ID;
        bar.style.cssText = `
            width: 600px;
            padding: 7px 12px;
            margin-bottom: 6px;
            background: #21201d;
            border: 1px solid #3d3b37;
            border-radius: 4px;
            font-size: 13px;
            color: #bababa;
            letter-spacing: 0.4px;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 8px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        bar.innerHTML = `
            <span style="color:#779556; font-weight:bold; font-size:11px; text-transform:uppercase; letter-spacing:1px;">Opening</span>
            <span id="${DISPLAY_ID}-text" style="color:#e0e0e0;">—</span>
        `;

        // Insert the bar directly above the board element
        board.parentNode.insertBefore(bar, board);

        // Adjust the game-container grid to accommodate the extra row
        const container = document.querySelector('.game-container');
        if (container) {
            container.style.gridTemplateColumns = '600px 300px';
            // Wrap board + bar in a column div if desired — here we simply
            // let the bar sit in the grid flow above the board naturally by
            // making the container a single-column flexbox for the left side.
        }
    }

    function setDisplayText(text, eco) {
        const el = document.getElementById(`${DISPLAY_ID}-text`);
        if (!el) return;
        el.textContent = eco ? `${text}  (${eco})` : text;
        el.style.color = text === 'Unknown Opening' ? '#666' : '#e0e0e0';
    }

    // ── Core update function ──────────────────────────────────────────────────

    function updateOpening() {
        if (typeof game === 'undefined') return;

        const history = game.history();          // SAN array
        if (history.length < MIN_MOVES) {
            setDisplayText('—');
            return;
        }

        const match = findOpening(history);
        if (match) {
            setDisplayText(match.name, match.eco);
        } else {
            setDisplayText('Unknown Opening');
        }
    }

    // ── Patch makeMove and engine response ───────────────────────────────────
    //  We hook AFTER chess.html's own scripts so we patch the already-patched
    //  window.makeMove. We also observe game.move for engine moves.

    function installHooks() {
        // 1) Patch human move handler
        const _orig = window.makeMove;
        if (typeof _orig === 'function') {
            window.makeMove = function (...args) {
                _orig.apply(this, args);
                updateOpening();
            };
        }

        // 2) Patch game.move to catch engine moves
        //    (engine calls game.move() directly inside stockfishWorker.onmessage)
        if (typeof game !== 'undefined' && typeof game.move === 'function') {
            const _origGameMove = game.move.bind(game);
            game.move = function (...args) {
                const result = _origGameMove(...args);
                if (result) {
                    // Defer slightly so any existing move hooks run first
                    setTimeout(updateOpening, 0);
                }
                return result;
            };
        }

        // 3) Also patch resetGame so the display clears on new game
        const _origReset = window.resetGame;
        if (typeof _origReset === 'function') {
            window.resetGame = function (...args) {
                _origReset.apply(this, args);
                setDisplayText('—');
            };
        }

        console.log('[opening-detection] Hooks installed ✓');
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────

    async function init() {
        await loadECO();
        injectDisplayBar();
        installHooks();
        updateOpening(); // Reflect any pre-existing position
    }

    // Wait for the page (and inline scripts) to fully load before patching
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOMContentLoaded already fired; run after current call stack clears
        // so chess.html's own <script> tags at the bottom have executed.
        setTimeout(init, 0);
    }

})();
