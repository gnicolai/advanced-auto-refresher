/**
 * Advanced Auto Refresher - Offscreen Document Script
 * Handles audio playback for Manifest V3 compliance
 */

let audio = null;
let isPlaying = false;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message) => {
    if (message.target !== 'offscreen') return;

    switch (message.type) {
        case 'PLAY_AUDIO':
            playAudio(message.audioUrl);
            break;

        case 'STOP_AUDIO':
            stopAudio();
            break;
    }
});

// Play audio
function playAudio(audioUrl) {
    if (isPlaying) return;

    try {
        audio = new Audio(audioUrl);
        audio.volume = 1.0;
        audio.loop = false;

        audio.onended = () => {
            isPlaying = false;
        };

        audio.onerror = (e) => {
            console.error('Audio playback error:', e);
            isPlaying = false;
            // Try playing generated sound as fallback
            playGeneratedAlarm();
        };

        audio.play()
            .then(() => {
                isPlaying = true;
            })
            .catch((error) => {
                console.error('Failed to play audio:', error);
                // Fallback to generated sound
                playGeneratedAlarm();
            });

    } catch (error) {
        console.error('Audio creation error:', error);
        playGeneratedAlarm();
    }
}

// Stop audio
function stopAudio() {
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio = null;
    }
    isPlaying = false;

    // Also stop oscillator if running
    if (oscillator) {
        oscillator.stop();
        oscillator = null;
    }
}

// Variables for generated alarm
let audioContext = null;
let oscillator = null;
let gainNode = null;

// Generate alarm sound using Web Audio API (fallback)
function playGeneratedAlarm() {
    if (isPlaying) return;
    isPlaying = true;

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.value = 0.5;

        // Create siren effect
        createSirenEffect();

    } catch (error) {
        console.error('Failed to create audio context:', error);
        isPlaying = false;
    }
}

// Create siren effect
function createSirenEffect() {
    const duration = 5; // 5 seconds
    const now = audioContext.currentTime;

    oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.connect(gainNode);

    // Siren frequency sweep
    for (let i = 0; i < duration * 2; i++) {
        // Low to high
        oscillator.frequency.setValueAtTime(400, now + i * 0.5);
        oscillator.frequency.linearRampToValueAtTime(800, now + i * 0.5 + 0.25);
        // High to low
        oscillator.frequency.linearRampToValueAtTime(400, now + i * 0.5 + 0.5);
    }

    oscillator.start(now);
    oscillator.stop(now + duration);

    oscillator.onended = () => {
        isPlaying = false;
        oscillator = null;
    };
}

console.log('Offscreen audio handler ready');
