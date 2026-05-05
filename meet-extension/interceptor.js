// interceptor.js
// Runs in the MAIN world, overriding `getUserMedia`

let originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
let audioContext;
let meetDestination;
let realMicSource;
let workletNode;
let securePort = null;
let extensionWorkletUrl = null;
let isConsultantActive = false;
let isMuted = false;

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
    } else if (workletNode) {
      // If workletNode already exists (e.g., user switched mic in Meet settings),
      // we must connect the new microphone source to the existing workletNode!
      realMicSource.connect(workletNode);
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
    console.log("Google Meet changed speaker to:", sinkId);
    if (audioContext && typeof audioContext.setSinkId === 'function') {
      try {
        await audioContext.setSinkId(sinkId);
        console.log("AI Consultant speaker updated to match Google Meet.");
      } catch (err) {
        console.error("Failed to sync AI Consultant speaker:", err);
      }
    }
    return originalSetSinkId.apply(this, arguments);
  };
}

async function setupWorklet() {
  if (!audioContext || !extensionWorkletUrl) return;
  try {
    console.log("Setting up AudioWorklet with URL:", extensionWorkletUrl);
    await audioContext.audioWorklet.addModule(extensionWorkletUrl);
    workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor');
    
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
      }
    };
    console.log("Secure channel established with isolated world.");
  }
});

// Announce we are ready
window.postMessage({ type: 'INTERCEPTOR_READY' }, '*');
