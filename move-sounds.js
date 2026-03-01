/**
 * move-sounds.js
 * Chess move sound effects using the Web Audio API — no external files required.
 * Drop-in replacement for the MP3-based version.
 */

(function () {
    'use strict';

    // ── AudioContext (lazy, created on first user gesture) ─────────────────────
    let ctx = null;

    function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // ── Low-level helpers ──────────────────────────────────────────────────────

    /**
     * Creates a gain node that fades to 0 over `duration` seconds then
     * disconnects everything — so nodes don't pile up.
     */
    function makeEnvelope(c, peakGain, attackTime, decayTime) {
        const g = c.createGain();
        const now = c.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(peakGain, now + attackTime);
        g.gain.exponentialRampToValueAtTime(0.0001, now + attackTime + decayTime);
        return g;
    }

    /** Simple oscillator burst — pitched tone */
    function playTone(freq, type, gain, attack, decay, destination) {
        const c = getCtx();
        const osc = c.createOscillator();
        const env = makeEnvelope(c, gain, attack, decay);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, c.currentTime);
        osc.connect(env);
        env.connect(destination || c.destination);
        osc.start(c.currentTime);
        osc.stop(c.currentTime + attack + decay + 0.05);
    }

    /** Noise burst (white noise shaped by an envelope) */
    function playNoise(gain, attack, decay, filterFreq, destination) {
        const c = getCtx();
        const bufSize = c.sampleRate * (attack + decay + 0.1);
        const buffer = c.createBuffer(1, bufSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        const source = c.createBufferSource();
        source.buffer = buffer;

        const filter = c.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = filterFreq;
        filter.Q.value = 0.8;

        const env = makeEnvelope(c, gain, attack, decay);
        source.connect(filter);
        filter.connect(env);
        env.connect(destination || c.destination);
        source.start(c.currentTime);
    }

    // ── Sound synthesisers ─────────────────────────────────────────────────────

    /**
     * move — soft wooden "thud" — low-mid thump + subtle click
     */
    function synthMove() {
        const c = getCtx();
        // Low wooden thump
        playNoise(0.55, 0.002, 0.09, 280, c.destination);
        // Short transient click
        playTone(1200, 'sine', 0.15, 0.001, 0.025, c.destination);
    }

    /**
     * capture — sharper, heavier impact — more noise energy + mid crack
     */
    function synthCapture() {
        const c = getCtx();
        // Heavier impact noise
        playNoise(0.75, 0.001, 0.15, 350, c.destination);
        // Mid crack
        playNoise(0.4, 0.001, 0.07, 1200, c.destination);
        // Impact tone
        playTone(160, 'sine', 0.3, 0.001, 0.12, c.destination);
    }

    /**
     * castle — two quick wooden clunks in succession
     */
    function synthCastle() {
        const c = getCtx();
        // First piece (king)
        playNoise(0.55, 0.002, 0.09, 280, c.destination);
        playTone(1100, 'sine', 0.12, 0.001, 0.025, c.destination);
        // Second piece (rook) — 120 ms later
        setTimeout(() => {
            if (ctx && ctx.state !== 'closed') {
                playNoise(0.5, 0.002, 0.09, 300, c.destination);
                playTone(1000, 'sine', 0.12, 0.001, 0.025, c.destination);
            }
        }, 120);
    }

    /**
     * check — bright alert tone — rising minor second + accent noise
     */
    function synthCheck() {
        const c = getCtx();
        const now = c.currentTime;

        // Bright ding
        const osc1 = c.createOscillator();
        const osc2 = c.createOscillator();
        const env = makeEnvelope(c, 0.45, 0.005, 0.35);
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(880, now);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1047, now); // minor second up
        osc1.connect(env); osc2.connect(env);
        env.connect(c.destination);
        osc1.start(now); osc1.stop(now + 0.42);
        osc2.start(now); osc2.stop(now + 0.42);

        // Short wooden thud underneath
        playNoise(0.4, 0.002, 0.07, 300, c.destination);
    }

    /**
     * checkmate — dramatic falling tone + heavy thud
     */
    function synthCheckmate() {
        const c = getCtx();
        const now = c.currentTime;

        // Falling glide
        const osc = c.createOscillator();
        const env = makeEnvelope(c, 0.55, 0.01, 0.9);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.9);
        osc.connect(env);
        env.connect(c.destination);
        osc.start(now); osc.stop(now + 1.0);

        // Heavy impact noise
        playNoise(0.8, 0.001, 0.35, 200, c.destination);

        // Subtle second thud at 250ms
        setTimeout(() => {
            if (ctx && ctx.state !== 'closed') {
                playNoise(0.5, 0.001, 0.25, 220, c.destination);
            }
        }, 250);
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    const SYNTHS = {
        move:      synthMove,
        capture:   synthCapture,
        castle:    synthCastle,
        check:     synthCheck,
        checkmate: synthCheckmate,
    };

    function play(key) {
        const fn = SYNTHS[key];
        if (!fn) { console.warn('[move-sounds] Unknown key:', key); return; }
        try { fn(); } catch (e) { console.error('[move-sounds] play() error:', e); }
    }

    // ── Move classification (unchanged logic from original) ────────────────────

    function soundForMove(moveResult, chessInstance) {
        if (!moveResult) return 'move';
        if (chessInstance.in_checkmate())             return 'checkmate';
        if (chessInstance.in_check())                 return 'check';
        const f = moveResult.flags || '';
        if (f.includes('k') || f.includes('q'))      return 'castle';
        if (f.includes('c') || f.includes('e'))      return 'capture';
        return 'move';
    }

    // ── Hook installation (identical structure to original) ───────────────────

    function installHook() {
        if (typeof makeMove !== 'function') {
            setTimeout(installHook, 50);
            return;
        }

        // ── Human moves ──────────────────────────────────────────────────────────
        const _origMakeMove = window.makeMove;
        window.makeMove = function (from, to) {
            const before = game.history().length;
            _origMakeMove(from, to);
            if (game.history().length > before) {
                const last = game.history({ verbose: true }).slice(-1)[0];
                play(soundForMove(last, game));
            }
        };

        // ── Engine moves (Stockfish calls game.move directly) ────────────────────
        const _origMove = game.move.bind(game);
        game.move = function (arg) {
            const result = _origMove(arg);
            if (result && !game._humanMovePending) {
                play(soundForMove(result, game));
            }
            return result;
        };

        // Flag human moves so the game.move hook stays silent for those
        const _origMakeMove2 = window.makeMove;
        window.makeMove = function (from, to) {
            game._humanMovePending = true;
            _origMakeMove2(from, to);
            game._humanMovePending = false;
        };

        console.log('[move-sounds] WebAudio hooks installed ✓');
    }

    // Bootstrap after all inline scripts have executed
    window.addEventListener('load', installHook);

    // Expose public API
    window.ChessSounds = { play };

})();