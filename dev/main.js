import { GeminiLiveClient } from './gemini-live-client.js';

const connectionStatus = document.getElementById('connection-status');
const connectionDot = document.getElementById('connection-dot');
const micButton = document.getElementById('mic-button');
const chatHistory = document.getElementById('chat-history');

// Audio variables
let audioContext;
let audioWorkletNode;
let mediaStream;
let isRecording = false;

// Playback queue variables
let playbackContext;
let nextPlayTime = 0;

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
  addSystemMessage("Error: VITE_GEMINI_API_KEY is not set in .env file.");
}

const client = new GeminiLiveClient(API_KEY);

client.onOpen = () => {
  connectionStatus.textContent = 'Connected';
  connectionDot.classList.add('connected');
  micButton.disabled = false;
  addSystemMessage("Connected to AI Consultant. Click mic to speak.");
};

client.onClose = (e) => {
  connectionStatus.textContent = 'Disconnected';
  connectionDot.classList.remove('connected');
  micButton.disabled = true;
  stopRecording();
  addSystemMessage(`Disconnected from server. Code: ${e.code}, Reason: ${e.reason || 'None'}`);
};

client.onError = (err) => {
  console.error("WebSocket Error", err);
  addSystemMessage("Connection error occurred.");
};

client.onMessage = (data) => {
  // Handle server responses
  if (data.serverContent && data.serverContent.modelTurn) {
    const parts = data.serverContent.modelTurn.parts;
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        // We received audio data
        playAudio(part.inlineData.data);
      }
      if (part.text) {
        // We received text data
        addAiMessage(part.text);
      }
    }
  }
};

// Start connection if we have a key
if (API_KEY) {
  client.connect();
}

// Convert Int16Array to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to Int16Array
function base64ToInt16Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

async function startRecording() {
  try {
    // 16kHz for Gemini input
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    await audioContext.audioWorklet.addModule('/audio-worklet-processor.js');

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    } });

    const source = audioContext.createMediaStreamSource(mediaStream);
    audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');

    audioWorkletNode.port.onmessage = (event) => {
      // event.data is Int16Array
      const base64Audio = arrayBufferToBase64(event.data.buffer);
      client.sendAudioChunk(base64Audio);
    };

    source.connect(audioWorkletNode);
    audioWorkletNode.connect(audioContext.destination);

    isRecording = true;
    micButton.classList.add('recording');
    addSystemMessage("Listening...");
  } catch (err) {
    console.error("Error accessing microphone:", err);
    addSystemMessage("Error accessing microphone. Check permissions.");
  }
}

function stopRecording() {
  if (isRecording) {
    if (audioWorkletNode) audioWorkletNode.disconnect();
    if (audioContext) audioContext.close();
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    
    isRecording = false;
    micButton.classList.remove('recording');
  }
}

// Playback logic (Gemini returns 24kHz audio)
async function playAudio(base64Pcm) {
  if (!playbackContext) {
    playbackContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  }

  const int16Array = base64ToInt16Array(base64Pcm);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  const audioBuffer = playbackContext.createBuffer(1, float32Array.length, 24000);
  audioBuffer.getChannelData(0).set(float32Array);

  const source = playbackContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(playbackContext.destination);

  if (nextPlayTime < playbackContext.currentTime) {
    nextPlayTime = playbackContext.currentTime;
  }
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
}

// UI Helpers
function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'message system-message';
  div.innerHTML = `<p>${text}</p>`;
  chatHistory.appendChild(div);
  scrollToBottom();
}

function addAiMessage(text) {
  const div = document.createElement('div');
  div.className = 'message ai-message';
  div.innerHTML = `<p>${text}</p>`;
  chatHistory.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.querySelector('.chat-container');
  container.scrollTop = container.scrollHeight;
}

micButton.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    // If playback context is suspended (browser policy), resume it
    if (playbackContext && playbackContext.state === 'suspended') {
      playbackContext.resume();
    }
    startRecording();
  }
});
