// interceptor.js
// Runs in the MAIN world, overriding `getUserMedia`

let originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let meetContext;
let geminiContext;
let meetDestination;
let realMicSource;
let workletNode;
let securePort = null;
let extensionWorkletUrl = null;
let isConsultantActive = false;
let isMuted = false;
let currentSinkId = null;

// 1. Intercept getUserMedia
navigator.mediaDevices.getUserMedia = async function(constraints) {
  const stream = await originalGetUserMedia(constraints);
  
  if (constraints.audio) {
    // We only intercept the audio stream
    if (!meetContext) {
      meetContext = new (window.AudioContext || window.webkitAudioContext)(); // Default rate for Meet
      geminiContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); // 16kHz for Gemini
      // Immediately resume contexts (user gesture will have triggered extension activation)
      meetContext.resume().catch(()=>{});
      geminiContext.resume().catch(()=>{});
    }
    
    // Create a destination node that we will give to Google Meet
    meetDestination = meetContext.createMediaStreamDestination();
    
    // Connect the real mic to the destination so Meet still hears the user
    realMicSource = meetContext.createMediaStreamSource(stream);
    realMicSource.connect(meetDestination);
    
    // Setup worklet if we have the URL
    if (extensionWorkletUrl && !workletNode) {
      await setupWorklet(stream);
    } else if (workletNode) {
      // If workletNode already exists, connect new mic to Gemini worklet
      const geminiMicSource = geminiContext.createMediaStreamSource(stream);
      geminiMicSource.connect(workletNode);
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

// 2. Intercept setSinkId to follow Google Meet's speaker selection
const originalSetSinkId = HTMLMediaElement.prototype.setSinkId;
if (originalSetSinkId) {
  HTMLMediaElement.prototype.setSinkId = async function(sinkId) {
    if (sinkId === currentSinkId) {
      return originalSetSinkId.apply(this, arguments);
    }
    currentSinkId = sinkId;
    console.log("Google Meet changed speaker to:", sinkId);
    if (meetContext && typeof meetContext.setSinkId === 'function') {
      try {
        await meetContext.setSinkId(sinkId);
        console.log("AI Consultant speaker updated to match Google Meet.");
      } catch (err) {
        console.error("Failed to sync AI Consultant speaker:", err);
      }
    }
    return originalSetSinkId.apply(this, arguments);
  };
}

async function setupWorklet(stream) {
  if (!geminiContext || !extensionWorkletUrl) return;
  try {
    console.log("Setting up AudioWorklet with URL:", extensionWorkletUrl);
    await geminiContext.audioWorklet.addModule(extensionWorkletUrl);
    workletNode = new AudioWorkletNode(geminiContext, 'audio-recorder-processor');
    
    let chunkCount = 0;
    workletNode.port.onmessage = (event) => {
      if (!isConsultantActive || isMuted || !securePort) return;
      const base64Audio = arrayBufferToBase64(event.data.buffer);
      securePort.postMessage({ type: 'MIC_AUDIO', data: base64Audio });
      chunkCount++;
      if (chunkCount % 50 === 0) {
        // console.log("Sent 50 audio chunks via secure port...");
      }
    };
    
    const geminiMicSource = geminiContext.createMediaStreamSource(stream);
    geminiMicSource.connect(workletNode);
    workletNode.connect(geminiContext.destination);
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

let nextPlayTime = 0;
function playAudio(base64Pcm) {
  if (!meetContext) return;
  
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

  // Gemini returns 24kHz audio. We decode it into meetContext which runs at default rate (e.g. 48kHz).
  const audioBuffer = meetContext.createBuffer(1, float32Array.length, 24000);
  audioBuffer.getChannelData(0).set(float32Array);

  const source = meetContext.createBufferSource();
  source.buffer = audioBuffer;
  
  // Connect to local speakers so YOU can hear it
  source.connect(meetContext.destination);
  
  // Connect to meetDestination so OTHERS can hear it (Option B magic)
  if (meetDestination) {
    source.connect(meetDestination);
  }

  // Add a tiny look-ahead safety margin (10ms) to prevent gaps
  const safetyMargin = 0.01;
  if (nextPlayTime < meetContext.currentTime + safetyMargin) {
    nextPlayTime = meetContext.currentTime + safetyMargin;
  }
  source.start(nextPlayTime);
  nextPlayTime += audioBuffer.duration;
}

// Messaging with content.js
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'EXTENSION_INIT') {
    extensionWorkletUrl = event.data.workletUrl;
    // We only call setupWorklet when getUserMedia is called and stream is available.
  } else if (event.data && event.data.type === 'INIT_SECURE_CHANNEL') {
    securePort = event.ports[0];
    securePort.onmessage = (msgEvent) => {
      const data = msgEvent.data;
      if (data.type === 'PLAY_AUDIO') {
        playAudio(data.base64Pcm);
      } else if (data.type === 'TOGGLE_STATE') {
        isConsultantActive = data.isActive;
        isMuted = data.isMuted;
        console.log("Interceptor state updated: Active=", isConsultantActive, "Muted=", isMuted);
        // Attempt to resume AudioContexts after a user gesture (toggle button click)
        if (meetContext) {
          meetContext.resume().catch(() => {});
        }
        if (geminiContext) {
          geminiContext.resume().catch(() => {});
        }      }
    };
    console.log("Secure channel established with isolated world.");
  }
});

// Expose helper for popup to resume AudioContext after user gesture
window.meetGemini = {
  resume: () => {
    if (meetContext && meetContext.state === 'suspended') {
      meetContext.resume().then(() => console.log('[Interceptor] meetContext resumed via user gesture'));
    }
    if (geminiContext && geminiContext.state === 'suspended') {
      geminiContext.resume().then(() => console.log('[Interceptor] geminiContext resumed via user gesture'));
    }
  }
};

// Announce we are ready
window.postMessage({ type: 'INTERCEPTOR_READY' }, '*');
