// gemini-live-client.js

export class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.onMessage = null;
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
    
    // We use gemini-2.0-flash-exp as it's the standard for multimodal live API, 
    // but updating to the user's requested model from the python script:
    this.model = "models/gemini-3.1-flash-live-preview";
  }

  connect() {
    // Changing to v1beta to match the python script
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.sendSetup();
      if (this.onOpen) this.onOpen();
    };

    this.ws.onmessage = async (event) => {
      let data;
      if (event.data instanceof Blob) {
        const text = await event.data.text();
        data = JSON.parse(text);
      } else {
        data = JSON.parse(event.data);
      }
      
      if (this.onMessage) this.onMessage(data);
    };

    this.ws.onclose = (e) => {
      console.log("WebSocket closed. Code:", e.code, "Reason:", e.reason);
      if (this.onClose) this.onClose(e);
    };

    this.ws.onerror = (err) => {
      if (this.onError) this.onError(err);
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
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Zephyr"
              }
            }
          }
        },
        systemInstruction: {
          parts: [{
            text: `You act as a AI Solution Consultant for AWS, Google Cloud Plattform and Azure, this includes a rich array of AI educational resources, courses, and practical applications. Begin with asking about the company and the szenario. Then proceed with the steps defined in your instructions to analyze the situation, identify potentials, and plan a pilot project. Keep answers concise and avoid emoticons.`
          }]
        }
      }
    };
    this.ws.send(JSON.stringify(setupMsg));
  }

  sendAudioChunk(base64Pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const msg = {
      realtimeInput: {
        // Updated to use the new 'audio' field instead of deprecated 'mediaChunks'
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Pcm
        }
      }
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const msg = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: text }]
          }
        ],
        turnComplete: true
      }
    };
    this.ws.send(JSON.stringify(msg));
  }
}
