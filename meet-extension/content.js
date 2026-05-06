// content.js
// Runs in the isolated extension world. Communicates with popup and background,
// and bridges data to the interceptor.js running in the MAIN world.

let workletUrl = chrome.runtime.getURL('audio-worklet-processor.js');

// Add visual indicator to Google Meet
let badge = document.createElement('div');
badge.style.position = 'fixed';
badge.style.bottom = '80px';
badge.style.left = '20px';
badge.style.padding = '10px 15px';
badge.style.background = '#22c55e';
badge.style.color = 'white';
badge.style.borderRadius = '8px';
badge.style.fontFamily = 'sans-serif';
badge.style.fontWeight = 'bold';
badge.style.zIndex = '999999';
badge.style.display = 'none';
badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
badge.style.cursor = 'pointer';
badge.style.transition = 'all 0.2s ease';
badge.textContent = 'AI Consultant: Listening 🎙️';
document.body.appendChild(badge);

// Hover effect
badge.addEventListener('mouseenter', () => { badge.style.transform = 'scale(1.05)'; });
badge.addEventListener('mouseleave', () => { badge.style.transform = 'scale(1)'; });

let isActive = false;
let isMuted = false;
let geminiClient = null;
let securePort = null;

// Initialize secure MessageChannel
const channel = new MessageChannel();
securePort = channel.port1;
securePort.onmessage = (event) => {
  if (event.data.type === 'MIC_AUDIO' && geminiClient) {
    geminiClient.sendAudioChunk(event.data.data);
  }
};
window.postMessage({ type: 'INIT_SECURE_CHANNEL' }, '*', [channel.port2]);

// ... Gemini Client Class ...
class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.model = "models/gemini-3.1-flash-live-preview";
  }

  connect() {
    const baseUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
    const url = new URL(baseUrl);
    url.searchParams.set('key', this.apiKey);
    
    console.log("[Secure World] Connecting to Gemini API...");
    this.ws = new WebSocket(url.toString());
    this.ws.onopen = () => {
      console.log("[Secure World] Connected to Gemini API.");
      this.sendSetup();
    };
    this.ws.onmessage = async (event) => {
      let text = event.data;
      if (text instanceof Blob) {
        text = await text.text();
      }
      this.handleMessage(JSON.parse(text));
    };
    this.ws.onclose = (e) => {
      console.log("[Secure World] Consultant disconnected", e.code, e.reason);
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      isActive = false;
      updateBadgeState();
    };

    // Heartbeat to keep connection alive during silence
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendAudioChunk(""); // Send empty data to keep pipe open
      }
    }, 20000); // Every 20s
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  sendSetup() {
    const setupMsg = {
      setup: {
        model: this.model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } }
        },
        systemInstruction: {
          parts: [{ text: "You act as a AI Solution Consultant for AWS, Google Cloud Plattform and Azure, this includes a rich array of AI educational resources, courses, and practical applications. Begin with asking about the company and the szenario. Keep your answers concise and do not use emoticons." }]
        }
      }
    };
    this.ws.send(JSON.stringify(setupMsg));
  }

  sendAudioChunk(base64Pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = { realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: base64Pcm } } };
    this.ws.send(JSON.stringify(msg));
  }

  handleMessage(data) {
    if (data.serverContent && data.serverContent.modelTurn) {
      const parts = data.serverContent.modelTurn.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          if (securePort) {
            securePort.postMessage({ type: 'PLAY_AUDIO', base64Pcm: part.inlineData.data });
          }
        }
      }
    }
  }
}

function updateBadgeState() {
  if (isActive) {
    badge.style.display = 'block';
    if (isMuted) {
      badge.style.background = '#f59e0b'; // Amber color for muted
      badge.textContent = 'AI Consultant: Muted 🔇';
    } else {
      badge.style.background = '#22c55e'; // Green for listening
      badge.textContent = 'AI Consultant: Listening 🎙️';
    }
  } else {
    badge.style.display = 'none';
  }
  if (securePort) {
    securePort.postMessage({ type: 'TOGGLE_STATE', isActive: isActive, isMuted: isMuted });
  }
}

// Click to mute/unmute
badge.addEventListener('click', () => {
  if (!isActive) return;
  isMuted = !isMuted;
  updateBadgeState();
});

// Send initial setup info to MAIN world unconditionally
// (interceptor.js runs at document_start, so its listener is already active)
window.postMessage({
  type: 'EXTENSION_INIT',
  workletUrl: workletUrl
}, '*');

// Also respond if interceptor asks for it late
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'INTERCEPTOR_READY') {
    window.postMessage({
      type: 'EXTENSION_INIT',
      workletUrl: workletUrl
    }, '*');
    window.postMessage({ type: 'INIT_SECURE_CHANNEL' }, '*', [channel.port2]);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_STATE') {
    sendResponse({ isActive: isActive });
    return true;
  }

  if (request.action === 'TOGGLE_CONSULTANT') {
    chrome.storage.local.get(['geminiApiKey'], (result) => {
      if (result.geminiApiKey) {
        isActive = !isActive;
        // Reset mute state when activating
        if (isActive) {
          isMuted = false;
          geminiClient = new GeminiLiveClient(result.geminiApiKey);
          geminiClient.connect();
        } else {
          if (geminiClient) geminiClient.disconnect();
          geminiClient = null;
        }
        updateBadgeState();
        sendResponse({ status: 'ok', isActive: isActive });
      } else {
        alert("Please set your Gemini API Key in the extension popup first.");
        sendResponse({ status: 'error' });
      }
    });
    return true; // Keep message channel open for async response
  }
});
