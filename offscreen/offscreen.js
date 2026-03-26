/**
 * Auto Refresh & Page Monitor with Telegram Alerts - Offscreen Document Script
 * Handles audio playback for Manifest V3 compliance
 * Supports multiple sound types and volume control
 */

let isPlaying = false;
let audioContext = null;
let activeNodes = [];

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== 'offscreen') return;

    switch (message.type) {
        case 'PLAY_AUDIO':
            playSound(message.soundType || 'siren', message.volume ?? 0.8);
            break;

        case 'STOP_AUDIO':
            stopAudio();
            break;
    }
});

// Stop all audio
function stopAudio() {
    isPlaying = false;
    activeNodes.forEach(node => {
        try { node.stop(); } catch { }
    });
    activeNodes = [];
    if (audioContext) {
        audioContext.close().catch(() => { });
        audioContext = null;
    }
}

// Play a specific sound type at a given volume
function playSound(soundType, volume) {
    stopAudio();
    isPlaying = true;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = Math.max(0, Math.min(1, volume));

        switch (soundType) {
            case 'beep': playBeep(gainNode); break;
            case 'chime': playChime(gainNode); break;
            case 'alarm': playAlarm(gainNode); break;
            case 'bell': playBell(gainNode); break;
            case 'digital': playDigital(gainNode); break;
            case 'siren':
            default: playSiren(gainNode); break;
        }
    } catch (error) {
        console.error('Audio playback error:', error);
        isPlaying = false;
    }
}

// Helper to create and track an oscillator
function createOsc(type, gainNode) {
    const osc = audioContext.createOscillator();
    osc.type = type;
    osc.connect(gainNode);
    activeNodes.push(osc);
    osc.onended = () => {
        activeNodes = activeNodes.filter(n => n !== osc);
        if (activeNodes.length === 0) {
            isPlaying = false;
            chrome.runtime.sendMessage({ type: 'AUDIO_ENDED' }).catch(() => { });
        }
    };
    return osc;
}

// ─── Sound Generators ──────────────────────────────────

// 🚨 Siren — sweeping sine 400→800Hz (original)
function playSiren(gainNode) {
    const duration = 5;
    const now = audioContext.currentTime;
    const osc = createOsc('sine', gainNode);

    for (let i = 0; i < duration * 2; i++) {
        osc.frequency.setValueAtTime(400, now + i * 0.5);
        osc.frequency.linearRampToValueAtTime(800, now + i * 0.5 + 0.25);
        osc.frequency.linearRampToValueAtTime(400, now + i * 0.5 + 0.5);
    }

    osc.start(now);
    osc.stop(now + duration);
}

// 🔔 Beep — 3 short beeps
function playBeep(gainNode) {
    const now = audioContext.currentTime;
    const beepGain = audioContext.createGain();
    beepGain.connect(gainNode);

    const osc = createOsc('sine', beepGain);
    osc.frequency.value = 880;

    // Envelope: 3 beeps with gaps
    beepGain.gain.setValueAtTime(0, now);
    for (let i = 0; i < 3; i++) {
        const t = now + i * 0.4;
        beepGain.gain.setValueAtTime(1, t);
        beepGain.gain.setValueAtTime(0, t + 0.15);
    }

    osc.start(now);
    osc.stop(now + 1.2);
}

// 🎵 Chime — ascending 3-note sequence
function playChime(gainNode) {
    const now = audioContext.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const noteDuration = 0.4;

    notes.forEach((freq, i) => {
        const noteGain = audioContext.createGain();
        noteGain.connect(gainNode);

        const osc = createOsc('sine', noteGain);
        osc.frequency.value = freq;

        const start = now + i * noteDuration;
        noteGain.gain.setValueAtTime(0.8, start);
        noteGain.gain.exponentialRampToValueAtTime(0.01, start + noteDuration * 0.9);

        osc.start(start);
        osc.stop(start + noteDuration);
    });
}

// ⏰ Alarm — rapid pulsing at 660Hz
function playAlarm(gainNode) {
    const now = audioContext.currentTime;
    const duration = 3;
    const pulseRate = 0.1;

    const alarmGain = audioContext.createGain();
    alarmGain.connect(gainNode);

    const osc = createOsc('square', alarmGain);
    osc.frequency.value = 660;

    // Rapid on/off pulsing
    alarmGain.gain.setValueAtTime(0, now);
    const pulses = Math.floor(duration / (pulseRate * 2));
    for (let i = 0; i < pulses; i++) {
        const t = now + i * pulseRate * 2;
        alarmGain.gain.setValueAtTime(0.6, t);
        alarmGain.gain.setValueAtTime(0, t + pulseRate);
    }

    osc.start(now);
    osc.stop(now + duration);
}

// 🔔 Bell — single bell-like tone with natural decay
function playBell(gainNode) {
    const now = audioContext.currentTime;
    const duration = 2.5;

    // Fundamental + overtones for bell timbre
    const frequencies = [440, 880, 1320, 1760];
    const amplitudes = [1, 0.5, 0.25, 0.12];

    frequencies.forEach((freq, i) => {
        const bellGain = audioContext.createGain();
        bellGain.connect(gainNode);

        const osc = createOsc('sine', bellGain);
        osc.frequency.value = freq;

        bellGain.gain.setValueAtTime(amplitudes[i] * 0.5, now);
        bellGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration);
    });
}

// 💻 Digital — retro square-wave pattern
function playDigital(gainNode) {
    const now = audioContext.currentTime;
    const pattern = [
        { freq: 1200, dur: 0.08 },
        { freq: 800, dur: 0.08 },
        { freq: 1200, dur: 0.08 },
        { freq: 0, dur: 0.15 },
        { freq: 1000, dur: 0.08 },
        { freq: 600, dur: 0.08 },
        { freq: 1000, dur: 0.08 },
        { freq: 0, dur: 0.15 },
        { freq: 1200, dur: 0.08 },
        { freq: 800, dur: 0.08 },
        { freq: 1200, dur: 0.08 },
    ];

    const digiGain = audioContext.createGain();
    digiGain.connect(gainNode);

    const osc = createOsc('square', digiGain);
    let t = now;

    pattern.forEach(step => {
        if (step.freq === 0) {
            digiGain.gain.setValueAtTime(0, t);
        } else {
            osc.frequency.setValueAtTime(step.freq, t);
            digiGain.gain.setValueAtTime(0.4, t);
        }
        t += step.dur;
    });
    digiGain.gain.setValueAtTime(0, t);

    osc.start(now);
    osc.stop(t + 0.01);
}

console.log('Offscreen audio handler ready');
