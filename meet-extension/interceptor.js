// interceptor.js
// Runs in the MAIN world, overriding `getUserMedia`

let originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let audioContext;
let meetDestination;
let realMicSource;
let workletNode;
let geminiClient;
let extensionWorkletUrl = null;
let isConsultantActive = false;

// 1. Intercept getUserMedia
navigator.mediaDevices.getUserMedia = async function(constraints) {
  const stream = await originalGetUserMedia(constraints);
  
  if (constraints.audio) {
    // We only intercept the audio stream
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    }
    
    // Create a destination node that we will give to Google Meet
    meetDestination = audioContext.createMediaStreamDestination();
    
    // Connect the real mic to the destination so Meet still hears the user
    realMicSource = audioContext.createMediaStreamSource(stream);
    realMicSource.connect(meetDestination);
    
    // Setup worklet if we have the URL
    if (extensionWorkletUrl && !workletNode) {
      await setupWorklet();
    }
    
    // Return a new stream containing the original video track (if any) and our custom audio track
    const newStream = new MediaStream();
    if (constraints.video) {
      stream.getVideoTracks().forEach(track => newStream.addTrack(track));
    }
    meetDestination.stream.getAudioTracks().forEach(track => newStream.addTrack(track));
    
    return newStream;
  }
  
  return stream;
};

async function setupWorklet() {
  if (!audioContext || !extensionWorkletUrl) return;
  try {
    console.log("Setting up AudioWorklet with URL:", extensionWorkletUrl);
    await audioContext.audioWorklet.addModule(extensionWorkletUrl);
    workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');
    
    let chunkCount = 0;
    workletNode.port.onmessage = (event) => {
      if (!isConsultantActive || !geminiClient) return;
      const base64Audio = arrayBufferToBase64(event.data.buffer);
      geminiClient.sendAudioChunk(base64Audio);
      chunkCount++;
      if (chunkCount % 50 === 0) {
        console.log("Sent 50 audio chunks to Gemini...");
      }
    };
    
    realMicSource.connect(workletNode);
    workletNode.connect(audioContext.destination);
    console.log("AudioWorklet setup successful!");
  } catch (err) {
    console.error("Failed to setup AudioWorklet (possibly CSP issue):", err);
  }
}

// Helper: Int16Array Buffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ... Gemini Client Class ...
class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.model = "models/gemini-3.1-flash-live-preview";
  }

  connect() {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      console.log("Connected to Gemini API.");
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
      console.log("Consultant disconnected", e.code, e.reason);
      isConsultantActive = false;
    };
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
          console.log("Received audio response from Gemini!");
          playAudio(part.inlineData.data);
        }
        if (part.text) {
          console.log("Gemini text:", part.text);
        }
      }
    } else if (data.serverContent && data.serverContent.interrupted) {
      console.log("Gemini interrupted.");
    } else {
      // console.log("Other message from Gemini:", data);
    }
  }
}

let nextPlayTime = 0;
function playAudio(base64Pcm) {
  if (!audioContext) return;
  
  const binaryString = atob(base64Pcm);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer);
  
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  // Gemini returns 24kHz audio
  const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
  audioBuffer.getChannelData(0).set(float32Array);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  
  // Connect to local speakers so YOU can hear it
  source.connect(audioContext.destination);
  
  // Connect to meetDestination so OTHERS can hear it (Option B magic)
  if (meetDestination) {
    source.connect(meetDestination);
  }

  if (nextPlayTime < audioContext.currentTime) {
    nextPlayTime = audioContext.currentTime;
  }
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
}

// Messaging with content.js
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'EXTENSION_INIT') {
    extensionWorkletUrl = event.data.workletUrl;
    if (audioContext && !workletNode) {
      setupWorklet();
    }
  } else if (event.data && event.data.type === 'TOGGLE_CONSULTANT') {
    if (isConsultantActive) {
      if (geminiClient) geminiClient.disconnect();
      isConsultantActive = false;
      console.log("AI Consultant deactivated.");
    } else {
      console.log("Activating AI Consultant...");
      isConsultantActive = true;
      geminiClient = new GeminiLiveClient(event.data.apiKey);
      geminiClient.connect();
    }
  }
});

// Announce we are ready
window.postMessage({ type: 'INTERCEPTOR_READY' }, '*');
