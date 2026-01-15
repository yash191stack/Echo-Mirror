// Audio context and nodes
let audioContext;
let analyser;
let microphone;
let scriptProcessor; // Keep for broader compatibility for now
let gainNode;
let mediaStream;

// Canvas elements
const audioCanvas = document.getElementById('audioCanvas');
const canvasCtx = audioCanvas.getContext('2d');

// UI elements
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const loudnessDisplay = document.getElementById('loudness');
const dominantFrequencyDisplay = document.getElementById('dominantFrequency');
const frequencyRangeDisplay = document.getElementById('frequencyRange');
const soundTypeDisplay = document.getElementById('soundType');
const soundTypeConfidenceDisplay = document.getElementById('soundTypeConfidence');
const estimatedDistanceDisplay = document.getElementById('estimatedDistance');
const directionDisplay = document.getElementById('direction');
const currentSoundFeedback = document.getElementById('currentSoundFeedback');
const loudnessMeterFill = document.querySelector('#loudnessMeter .level-fill');
const sensitivitySlider = document.getElementById('sensitivity');
const ignoreAmbientNoiseToggle = document.getElementById('ignoreAmbientNoise');
const soundTimelineList = document.getElementById('soundTimelineList');
const clearTimelineButton = document.getElementById('clearTimelineButton');
const estimatedPitchDisplay = document.getElementById('estimatedPitch');
const voiceCharacteristicDisplay = document.getElementById('voiceCharacteristic');
const directionLeftIndicator = document.getElementById('directionLeft');
const directionCenterIndicator = document.getElementById('directionCenter');
const directionRightIndicator = document.getElementById('directionRight');
const directionTextDisplay = document.getElementById('directionText');
const soundEventAlert = document.getElementById('soundEventAlert');

const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

// Configuration
const FFT_SIZE = 2048; // For analyser
const SCRIPT_PROCESSOR_BUFFER_SIZE = 2048; // For ScriptProcessorNode
const SMOOTHING_TIME_CONSTANT = 0.8;
const MAX_TIMELINE_EVENTS = 10;
const BACKEND_URL = 'http://localhost:3000'; // Backend server URL

let currentSensitivity = 0.5; // Default sensitivity (0-1 range from slider)
let ignoreAmbientNoise = false;

// State variables
let soundDetected = false;
let soundTimeline = []; // Will be populated from backend
let peakLoudness = 0; // For peak hold
let peakDominantFrequency = 0; // For peak hold
let lastSoundEventTime = 0; // To debounce timeline events
const EVENT_DEBOUNCE_TIME_MS = 2000; // 2 seconds between timeline events

// Particle system for visualization
let particles = [];
const MAX_PARTICLES = 100;

// --- Event Listeners --- //
startButton.addEventListener('click', initAudio);
stopButton.addEventListener('click', stopAudio);
sensitivitySlider.addEventListener('input', (e) => {
    currentSensitivity = parseFloat(e.target.value) / 100;
    localStorage.setItem('echoMirrorSensitivity', currentSensitivity.toString()); // Save to localStorage
    if (gainNode) {
        gainNode.gain.value = currentSensitivity * 2; // Adjust gain for sensitivity
    }
});
    ignoreAmbientNoiseToggle.addEventListener('change', (e) => {
        ignoreAmbientNoise = e.target.checked;
        localStorage.setItem('echoMirrorIgnoreAmbientNoise', ignoreAmbientNoise.toString()); // Save to localStorage
    });
clearTimelineButton.addEventListener('click', clearTimeline);

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tabId = button.dataset.tab;
        activateTab(tabId);
    });
});

// --- Tab Management --- //
function activateTab(tabId) {
    tabButtons.forEach(button => {
        button.classList.remove('active');
        if (button.dataset.tab === tabId) {
            button.classList.add('active');
        }
    });

    tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === tabId) {
            content.classList.add('active');
        }
    });

    // If switching away from live analysis, stop audio to save resources
    if (tabId !== 'live-analysis' && audioContext && audioContext.state === 'running') {
        stopAudio();
    }
    // If switching to live analysis and not started yet, update button state
    if (tabId === 'live-analysis' && (!audioContext || audioContext.state === 'closed')) {
        startButton.disabled = false;
        startButton.textContent = '\u{1F50A} Start Echo Mirror'; // Speaker icon
    }
}

// --- Audio Initialization & Control --- //
async function initAudio() {
    if (audioContext && audioContext.state === 'running') {
        console.log("Audio already initialized and running.");
        return;
    }

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { stereo: true, echoCancellation: false } });

        microphone = audioContext.createMediaStreamSource(mediaStream);

        gainNode = audioContext.createGain();
        gainNode.gain.value = currentSensitivity * 2; // Initial gain

        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;

        scriptProcessor = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 2, 2); // 2 input, 2 output channels
        scriptProcessor.onaudioprocess = processAudio;

        microphone.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination); // Connect to destination to keep it alive

        startButton.textContent = 'Listening...';
        startButton.disabled = true;
        stopButton.disabled = false;
        currentSoundFeedback.textContent = 'Analyzing...';

        // Start continuous visual updates
        drawVisuals();

    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Could not access microphone. Please ensure permission is granted and a microphone is available.');
        startButton.textContent = '\u{1F50A} Start Echo Mirror';
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

function stopAudio() {
    if (audioContext) {
        if (audioContext.state === 'running') {
            audioContext.close().then(() => {
                console.log('AudioContext closed.');
                audioContext = null;
                microphone = null;
                analyser = null;
                scriptProcessor = null;
                gainNode = null;
                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }
                startButton.disabled = false;
                startButton.textContent = '\u{1F50A} Start Echo Mirror';
                stopButton.disabled = true;
                currentSoundFeedback.textContent = 'Microphone Off';
                resetMetrics();
                canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
            });
        } else {
            console.log('AudioContext not running.');
            startButton.disabled = false;
            startButton.textContent = '\u{1F50A} Start Echo Mirror';
            stopButton.disabled = true;
            currentSoundFeedback.textContent = 'Microphone Off';
            resetMetrics();
        }
    }
}

function resetMetrics() {
    loudnessDisplay.textContent = '0.0';
    dominantFrequencyDisplay.textContent = '-- Hz';
    frequencyRangeDisplay.textContent = 'Range: N/A';
    soundTypeDisplay.textContent = '--';
    soundTypeConfidenceDisplay.textContent = 'Confidence: --%';
    estimatedDistanceDisplay.textContent = '--';
    directionDisplay.textContent = '--';
    loudnessMeterFill.style.width = '0%';
    peakLoudness = 0;
    peakDominantFrequency = 0;
}

// --- Audio Processing Loop (from ScriptProcessorNode) --- //
function processAudio(event) {
    if (!analyser || !audioContext || audioContext.state !== 'running') return;

    const bufferLength = analyser.frequencyBinCount; // Half of FFT_SIZE
    const dataArray = new Uint8Array(bufferLength); // Frequency data
    analyser.getByteFrequencyData(dataArray);

    const timeDomainData = new Uint8Array(analyser.fftSize); // Waveform data
    analyser.getByteTimeDomainData(timeDomainData);

    // Get stereo data for direction estimation
    let leftChannelEnergy = 0;
    let rightChannelEnergy = 0;
    const inputBuffer = event.inputBuffer;

    if (inputBuffer.numberOfChannels >= 2) {
        const leftChannel = inputBuffer.getChannelData(0);
        const rightChannel = inputBuffer.getChannelData(1);

        for (let i = 0; i < leftChannel.length; i++) {
            leftChannelEnergy += leftChannel[i] * leftChannel[i];
            rightChannelEnergy += rightChannel[i] * rightChannel[i];
        }
    }

    // Calculate Loudness (RMS - Root Mean Square)
    let sumOfSquares = 0;
    for (const amplitude of timeDomainData) {
        const normalizedAmplitude = (amplitude / 128.0) - 1.0; // Normalize from 0-255 to -1 to 1
        sumOfSquares += normalizedAmplitude * normalizedAmplitude;
    }
    const rms = Math.sqrt(sumOfSquares / timeDomainData.length);
    let loudness = rms * 200; // Scale to a more visible range for display, max around 200

    // Apply sensitivity
    loudness *= (currentSensitivity * 2); // Further adjust based on slider

    if (ignoreAmbientNoise) {
        // Adaptive noise gating: simple approach for now
        const backgroundNoiseLevel = 5; // Example threshold
        if (loudness < backgroundNoiseLevel) {
            loudness = 0; // Treat as no sound
        }
    }

    soundDetected = loudness > 5; // Threshold for sound presence

    // Update peak loudness with decay
    if (loudness > peakLoudness) {
        peakLoudness = loudness;
    } else {
        peakLoudness *= 0.98; // Gradual decay
    }

    // Frequency Analysis
    const sampleRate = audioContext.sampleRate;
    let maxFrequencyValue = 0;
    let dominantFrequency = 0;
    let lowFrequencyEnergy = 0;
    let midFrequencyEnergy = 0;
    let highFrequencyEnergy = 0;

    const lowFreqThreshold = 500; // up to 500 Hz
    const midFreqThreshold = 2000; // up to 2000 Hz
    const highFreqThreshold = 6000; // up to 6kHz, typical laptop mic range

    for (let i = 0; i < bufferLength; i++) {
        const frequency = i * (sampleRate / FFT_SIZE);
        const value = dataArray[i];

        if (frequency > 20 && frequency < audioContext.sampleRate / 2) {
            if (value > maxFrequencyValue) {
                maxFrequencyValue = value;
                dominantFrequency = frequency;
            }
        }

        if (frequency < lowFreqThreshold) {
            lowFrequencyEnergy += value;
        } else if (frequency < midFreqThreshold) {
            midFrequencyEnergy += value;
        } else if (frequency < highFreqThreshold) {
            highFrequencyEnergy += value;
        }
    }

    // Update peak dominant frequency with decay
    if (dominantFrequency > peakDominantFrequency) {
        peakDominantFrequency = dominantFrequency;
    } else {
        peakDominantFrequency *= 0.99; // Gradual decay
    }

    let frequencyRange = 'N/A';
    const totalEnergy = lowFrequencyEnergy + midFrequencyEnergy + highFrequencyEnergy;
    if (totalEnergy > 0) {
        const lowRatio = lowFrequencyEnergy / totalEnergy;
        const midRatio = midFrequencyEnergy / totalEnergy;
        const highRatio = highFrequencyEnergy / totalEnergy;

        if (lowRatio > midRatio && lowRatio > highRatio) {
            frequencyRange = 'Low';
        } else if (midRatio > lowRatio && midRatio > highRatio) {
            frequencyRange = 'Mid';
        } else {
            frequencyRange = 'High';
        }
    }

    // Sound Type Estimation (Best-effort)
    let soundType = 'Ambient / Noise-like';
    let confidence = 40; // Base confidence
    let visualizerAccentColor = 'var(--accent-blue)'; // Default to ambient blue

    if (soundDetected) {
        const averageAmplitudeChange = calculateAverageAmplitudeChange(timeDomainData);
        const transientThreshold = 0.1; 

        if (averageAmplitudeChange > transientThreshold * (loudness / 100) && dominantFrequency > 1500 && loudness > 30) {
            soundType = 'Clap / Bang-like';
            confidence = 85;
            visualizerAccentColor = 'var(--primary-color)'; // Red
            triggerVibration([100, 50, 100]); // Short, sharp vibration for transient sounds
            triggerSoundAlert(); // Visual alert for sharp sounds
        } else if (dominantFrequency > 80 && dominantFrequency < 2800 && loudness > 15) {
            soundType = 'Voice-like';
            confidence = 75;
            visualizerAccentColor = 'var(--accent-yellow)'; // Yellow
            if (loudness > 50) {
                triggerVibration(200); // Longer vibration for loud voices
                triggerSoundAlert(); // Visual alert for loud voices
            } else if (maxFrequencyValue > 120 && loudness > 10) {
            soundType = 'Instrument / Tone-like';
            confidence = 65;
            visualizerAccentColor = 'var(--accent-yellow)'; // Yellow
        } else {
            soundType = 'Ambient / Noise-like';
            confidence = 50;
            visualizerAccentColor = 'var(--accent-blue)'; // Blue
        }
    }
    
    // Distance Estimation
    let estimatedDistance = 'N/A';
    if (loudness > 70) {
        estimatedDistance = 'Very Close';
    } else if (loudness > 30) {
        estimatedDistance = 'Near';
    } else if (loudness > 5) {
        estimatedDistance = 'Far';
    } else {
        estimatedDistance = 'No Sound';
    }

    // Direction Handling (Best-effort for stereo mics)
    let direction = 'Direction unavailable on this device';
    if (inputBuffer.numberOfChannels >= 2 && (leftChannelEnergy > 0 || rightChannelEnergy > 0)) {
        const energyDifference = Math.abs(leftChannelEnergy - rightChannelEnergy);
        const totalEnergy = leftChannelEnergy + rightChannelEnergy;
        const differenceRatio = totalEnergy > 0 ? energyDifference / totalEnergy : 0;

        const directionThreshold = 0.15;

        if (differenceRatio > directionThreshold) {
            if (leftChannelEnergy > rightChannelEnergy) {
                direction = 'Left';
            } else {
                direction = 'Right';
            }
        } else {
            direction = 'Center / Undetermined';
        }
    }

    // --- Update UI Elements (immediate) --- //
    loudnessDisplay.textContent = loudness.toFixed(1);
    dominantFrequencyDisplay.textContent = `${dominantFrequency.toFixed(0)} Hz`;
    frequencyRangeDisplay.textContent = `Range: ${frequencyRange}`;
    soundTypeDisplay.textContent = soundType;
    soundTypeConfidenceDisplay.textContent = `Confidence: ${confidence.toFixed(0)}%`;
    estimatedDistanceDisplay.textContent = estimatedDistance;
    // directionDisplay.textContent = direction; // This will be handled by updateDirectionUI
    updateDirectionUI(direction);

    loudnessMeterFill.style.width = `${Math.min(100, loudness / 1.5)}%`;

    currentSoundFeedback.textContent = soundDetected ? `Detected: ${soundType}` : `No Sound Detected`;
    currentSoundFeedback.style.color = visualizerAccentColor; // Dynamic color feedback

    // Add to timeline if a significant event and debounced
    const now = Date.now();
    if (soundDetected && loudness > 10 && (now - lastSoundEventTime > EVENT_DEBOUNCE_TIME_MS)) {
        const newEvent = {
            timestamp: new Date().toISOString(),
            type: soundType,
            frequency: dominantFrequency.toFixed(0) + ' Hz'
        };
        sendSoundEventToBackend(newEvent); 
        lastSoundEventTime = now;
    }

    // Pass data for canvas drawing (handled in drawVisuals animation loop)
    analyser._dataArray = dataArray;
    analyser._timeDomainData = timeDomainData;
    analyser._visualizerAccentColor = visualizerAccentColor;
    analyser._loudness = loudness;
    analyser._peakLoudness = peakLoudness; // Pass peak for visualization
    analyser._dominantFrequency = dominantFrequency; // Pass dominant frequency for visualization
    analyser._soundType = soundType; // Pass sound type for visualization

    // --- Pitch Estimation ---
    let estimatedPitch = 0;
    let voiceCharacteristic = 'N/A';

    // Only attempt to detect pitch for voice-like sounds above a certain loudness
    if (soundType === 'Voice-like' && loudness > 15) {
        const audioData = event.inputBuffer.getChannelData(0); // Use one channel for pitch detection
        estimatedPitch = getPitch(audioData, audioContext.sampleRate);

        if (estimatedPitch > 0) {
            // Simple categorization based on typical vocal ranges (highly estimated!)
            // These ranges are approximate and can vary
            if (estimatedPitch > 250) { // Typically female/child voices
                voiceCharacteristic = 'High-pitched (Child/Female-like)';
            } else if (estimatedPitch > 120) { // Typically adult male voices
                voiceCharacteristic = 'Mid-pitched (Adult-like)';
            } else if (estimatedPitch > 70) { // Lower range male voices
                voiceCharacteristic = 'Low-pitched (Male-like)';
            }
        } else {
            voiceCharacteristic = 'Undetermined';
        }
    } else {
        // Reset pitch display if not voice-like or too quiet
        estimatedPitchDisplay.textContent = '-- Hz';
        voiceCharacteristicDisplay.textContent = 'Character: N/A';
    }

    estimatedPitchDisplay.textContent = estimatedPitch > 0 ? `${estimatedPitch.toFixed(1)} Hz` : '-- Hz';
    voiceCharacteristicDisplay.textContent = `Character: ${voiceCharacteristic} (estimated)`;

}

// --- Pitch Detection (Autocorrelation) ---
// This is a simplified autocorrelation for fundamental frequency estimation.
// It's a best-effort estimation and can be sensitive to noise and harmonics.
function getPitch(buffer, sampleRate) {
    const MIN_FREQ = 70; // Minimum detectable frequency (Hz) for human voice
    const MAX_FREQ = 600; // Maximum detectable frequency (Hz) for human voice
    const MIN_PERIOD = Math.floor(sampleRate / MAX_FREQ);
    const MAX_PERIOD = Math.floor(sampleRate / MIN_FREQ);

    const bufferSize = buffer.length;
    const correlations = new Float32Array(bufferSize);

    // Calculate autocorrelation
    // Optimized to only calculate correlations for relevant periods
    for (let i = 0; i < bufferSize; i++) {
        for (let j = 0; j < bufferSize - i; j++) {
            correlations[i] += buffer[j] * buffer[j + i];
        }
    }

    let maxCorrelation = -1;
    let bestPeriod = -1;

    // Find the highest peak in the autocorrelation function
    // within the expected vocal range periods.
    for (let i = MIN_PERIOD; i <= MAX_PERIOD; i++) {
        if (correlations[i] > maxCorrelation) {
            maxCorrelation = correlations[i];
            bestPeriod = i;
        }
    }

    // Check if the peak is significant enough to be considered a valid pitch
    // A higher threshold (e.g., 0.8) makes it more selective, lower (e.g., 0.5) more permissive.
    if (bestPeriod !== -1 && correlations[bestPeriod] > (correlations[0] * 0.7)) { // Correlation must be at least 70% of the peak at 0 lag
        const estimatedFreq = sampleRate / bestPeriod;
        // Refine the peak by parabolic interpolation for better accuracy (optional but improves quality)
        let s0 = correlations[bestPeriod - 1] || 0;
        let s1 = correlations[bestPeriod];
        let s2 = correlations[bestPeriod + 1] || 0;
        let denom = s0 - 2 * s1 + s2;
        if (denom !== 0) {
            let delta = (s0 - s2) / (2 * denom);
            return sampleRate / (bestPeriod + delta);
        }
        return estimatedFreq;
    }
    return 0; // No pitch detected or not significant enough
}


// --- Canvas Drawing Function (Animation Loop) --- //
function drawVisuals() {
    requestAnimationFrame(drawVisuals);

    if (!analyser || !audioContext || audioContext.state !== 'running') {
        // Clear canvas if audio is not running
        canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
        return;
    }

    const width = audioCanvas.width;
    const height = audioCanvas.height;

    canvasCtx.clearRect(0, 0, width, height);

    const dataArray = analyser._dataArray;
    const timeDomainData = analyser._timeDomainData;
    const visualizerAccentColor = analyser._visualizerAccentColor || 'var(--primary-color)';
    const currentLoudness = analyser._loudness || 0;
    const currentPeakLoudness = analyser._peakLoudness || 0;

    if (!dataArray || !timeDomainData) return; // Ensure data is available

    // Dynamic Background Glow/Pulse based on overall loudness
    const gradientRadius = (currentLoudness / 100) * Math.min(width, height) * 0.4;
    if (gradientRadius > 5) {
        const radialGradient = canvasCtx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, gradientRadius);
        radialGradient.addColorStop(0, `${visualizerAccentColor}80`); // 50% opacity
        radialGradient.addColorStop(1, `${visualizerAccentColor}00`); // Transparent
        canvasCtx.fillStyle = radialGradient;
        canvasCtx.fillRect(0, 0, width, height);
    }

    // --- Waveform Visualization --- //
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = visualizerAccentColor;
    canvasCtx.beginPath();
    const sliceWidth = width * 1.0 / analyser.fftSize;
    let x = 0;
    for (let i = 0; i < analyser.fftSize; i++) {
        const v = timeDomainData[i] / 128.0; // Normalize to -1 to 1
        const y = v * (height / 2) + height / 2;
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();

    // --- Frequency Spectrum Visualization (Bars with Gradient) --- //
    const barCount = Math.floor(width / 6); // More bars, thinner
    const barSpacing = 2;
    const actualBarWidth = (width - (barCount * barSpacing)) / barCount;
    x = 0;
    for (let i = 0; i < bufferLength; i++) {
        if (i > barCount) break; // Limit bars to prevent overcrowding
        let barHeight = dataArray[i] / 255 * height * 1.5; // Amplify for visual impact
        if (barHeight > height) barHeight = height; // Cap at max height

        const gradient = canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, `${visualizerAccentColor}40`); // Faded base
        gradient.addColorStop(0.7, visualizerAccentColor); // Solid color
        gradient.addColorStop(1, `white`); // Bright tip

        canvasCtx.fillStyle = gradient;
        canvasCtx.fillRect(x, height - barHeight, actualBarWidth, barHeight);

        x += actualBarWidth + barSpacing;
    }

    // --- Reactive Particle System --- //
    // Create new particles based on loudness
    if (currentLoudness > 20 && particles.length < MAX_PARTICLES) {
        for (let i = 0; i < (currentLoudness / 30); i++) { // More particles for louder sounds
            particles.push({
                x: Math.random() * width,
                y: height,
                radius: Math.random() * 3 + 1, // 1 to 4
                color: visualizerAccentColor,
                vx: (Math.random() - 0.5) * currentLoudness / 30, // Horizontal velocity based on loudness
                vy: - (Math.random() * currentLoudness / 10 + 2), // Upward velocity based on loudness
                alpha: 1,
                gravity: 0.1 // Simple gravity
            });
        }
    }

    // Update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= 0.01; // Fade out
        p.radius *= 0.98; // Shrink

        if (p.alpha <= 0.1 || p.radius < 0.5 || p.y > height + 50 || p.x < -50 || p.x > width + 50) {
            particles.splice(i, 1); // Remove faded/small/off-screen particles
        } else {
            canvasCtx.globalAlpha = p.alpha;
            canvasCtx.fillStyle = p.color;
            canvasCtx.beginPath();
            canvasCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            canvasCtx.fill();
        }
    }
    canvasCtx.globalAlpha = 1; // Reset alpha

    // Peak Loudness Indicator
    if (currentPeakLoudness > 0) {
        canvasCtx.fillStyle = visualizerAccentColor; // Use accent color for peak
        const peakIndicatorHeight = (currentPeakLoudness / 200) * height;
        canvasCtx.fillRect(0, height - peakIndicatorHeight, width, 3); // Thicker line for peak
    }

    // Dynamic border around canvas
    canvasCtx.strokeStyle = visualizerAccentColor;
    canvasCtx.lineWidth = 4; // Thicker border
    canvasCtx.strokeRect(0, 0, width, height);

    // Resize canvas on window resize
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    audioCanvas.width = audioCanvas.offsetWidth;
    audioCanvas.height = audioCanvas.offsetHeight;
}

// --- Pitch Detection (Autocorrelation) ---
// This is a simplified autocorrelation for fundamental frequency estimation.
// It's a best-effort estimation and can be sensitive to noise and harmonics.
function getPitch(buffer, sampleRate) {
    const MIN_FREQ = 70; // Minimum detectable frequency (Hz) for human voice
    const MAX_FREQ = 600; // Maximum detectable frequency (Hz) for human voice
    const MIN_PERIOD = Math.floor(sampleRate / MAX_FREQ);
    const MAX_PERIOD = Math.floor(sampleRate / MIN_FREQ);

    const bufferSize = buffer.length;
    const correlations = new Float32Array(bufferSize);

    // Calculate autocorrelation
    // Optimized to only calculate correlations for relevant periods
    for (let i = 0; i < bufferSize; i++) {
        for (let j = 0; j < bufferSize - i; j++) {
            correlations[i] += buffer[j] * buffer[j + i];
        }
    }

    let maxCorrelation = -1;
    let bestPeriod = -1;

    // Find the highest peak in the autocorrelation function
    // within the expected vocal range periods.
    for (let i = MIN_PERIOD; i <= MAX_PERIOD; i++) {
        if (correlations[i] > maxCorrelation) {
            maxCorrelation = correlations[i];
            bestPeriod = i;
        }
    }

    // Check if the peak is significant enough to be considered a valid pitch
    // A higher threshold (e.g., 0.8) makes it more selective, lower (e.g., 0.5) more permissive.
    if (bestPeriod !== -1 && correlations[bestPeriod] > (correlations[0] * 0.7)) { // Correlation must be at least 70% of the peak at 0 lag
        const estimatedFreq = sampleRate / bestPeriod;
        // Refine the peak by parabolic interpolation for better accuracy (optional but improves quality)
        let s0 = correlations[bestPeriod - 1] || 0;
        let s1 = correlations[bestPeriod];
        let s2 = correlations[bestPeriod + 1] || 0;
        let denom = s0 - 2 * s1 + s2;
        if (denom !== 0) {
            let delta = (s0 - s2) / (2 * denom);
            return sampleRate / (bestPeriod + delta);
        }
        return estimatedFreq;
    }
    return 0; // No pitch detected or not significant enough
}

// --- Utility Functions --- //
function calculateAverageAmplitudeChange(timeDomainData) {
    let totalChange = 0;
    for (let i = 1; i < timeDomainData.length; i++) {
        totalChange += Math.abs(timeDomainData[i] - timeDomainData[i - 1]);
    }
    return totalChange / (timeDomainData.length - 1);
}

function updateTimelineUI() {
    soundTimelineList.innerHTML = '';
    if (soundTimeline.length === 0) {
        const li = document.createElement('li');
        li.classList.add('timeline-placeholder');
        li.textContent = 'No events recorded yet. Start the Mirror and make some noise!';
        soundTimelineList.appendChild(li);
        return;
    }
    soundTimeline.forEach(event => {
        const li = document.createElement('li');
        // Assign a class based on sound type for color-coding
        let typeClass = 'timeline-event-' + event.type.toLowerCase().replace(/ /g, '-').replace(/\//g, '-');
        li.classList.add(typeClass);
        li.innerHTML = `
            <span><strong>Time:</strong> ${new Date(event.timestamp).toLocaleTimeString()}</span>
            <span><strong>Type:</strong> ${event.type}</span>
            <span><strong>Freq:</strong> ${event.frequency}</span>
        `;
        soundTimelineList.appendChild(li);
    });
}

// --- Backend Interaction --- //
async function sendSoundEventToBackend(event) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/sound-events`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        });
        if (!response.ok) {
            console.error('Failed to send sound event to backend:', response.statusText);
        } else {
            fetchSoundTimeline(); // Refresh timeline after new event
        }
    } catch (error) {
        console.error('Error sending sound event to backend:', error);
    }
}

async function fetchSoundTimeline() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/sound-events`);
        if (!response.ok) {
            console.error('Failed to fetch sound events from backend:', response.statusText);
            return;
        }
        const data = await response.json();
        soundTimeline = data.data.reverse(); // Backend returns latest first, reverse for oldest last
        updateTimelineUI();
    } catch (error) {
        console.error('Error fetching sound events from backend:', error);
    }
}

async function clearTimeline() {
    if (!confirm("Are you sure you want to clear the entire sound timeline?")) {
        return;
    }
    try {
        const response = await fetch(`${BACKEND_URL}/api/clear-events`, {
            method: 'POST',
        });
        if (!response.ok) {
            console.error('Failed to clear timeline on backend:', response.statusText);
        } else {
            console.log('Timeline cleared on backend.');
            soundTimeline = [];
            updateTimelineUI();
        }
    } catch (error) {
        console.error('Error clearing timeline on backend:', error);
    }
}

// --- Directional UI Update ---
function updateDirectionUI(direction) {
    // Reset all indicators first
    directionLeftIndicator.classList.remove('active');
    directionCenterIndicator.classList.remove('active');
    directionRightIndicator.classList.remove('active');

    directionTextDisplay.textContent = direction;

    switch (direction) {
        case 'Left':
            directionLeftIndicator.classList.add('active');
            break;
        case 'Right':
            directionRightIndicator.classList.add('active');
            break;
        case 'Center / Undetermined':
            directionCenterIndicator.classList.add('active');
            break;
        default: // 'Direction unavailable on this device' or 'N/A'
            // No indicator active, just show the text
            break;
    }
}

    }
}

// --- Sound Event Alert ---
function triggerSoundAlert() {
    soundEventAlert.classList.add('active');
    setTimeout(() => {
        soundEventAlert.classList.remove('active');
    }, 200); // Flash for 200ms
}

// --- Initial Load --- //
document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings on startup
    sensitivitySlider.value = (currentSensitivity * 100).toFixed(0);
    ignoreAmbientNoiseToggle.checked = ignoreAmbientNoise;

    resizeCanvas();
    activateTab('live-analysis'); // Activate default tab
    fetchSoundTimeline(); // Load existing timeline events
});
