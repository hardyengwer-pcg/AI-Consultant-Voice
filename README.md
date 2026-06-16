# Gemini AI Consultant for Google Meet

---

> [!NOTE]
> Dieses Projekt wurde mit Unterstützung von KI (Google Gemini) erstellt.

---

This Chrome Extension seamlessly integrates Google's Gemini Multimodal Live API directly into your Google Meet sessions. 

The AI Consultant joins your meeting as an invisible participant that **everyone can hear**. It listens to your microphone, processes the conversation using Gemini, and speaks its answers directly into the active Google Meet so that all participants can hear the AI's response in real-time.

## ✨ Features
- **Real-time Audio Streaming**: Uses WebSockets and `AudioWorklet` for ultra-low latency bidirectional audio.
- **Shared Audio Context**: The AI's audio response is mixed with your microphone stream and routed directly into Google Meet's WebRTC connection.
- **Secure Architecture**: Your Gemini API Key is stored safely in the isolated extension world and is never exposed to the Google Meet web page.
- **Interactive Mute Toggle**: Easily mute the AI consultant (so it stops listening) without disconnecting the session by clicking the floating badge in Google Meet.

## 🚀 Installation (Developer Mode)

1. Clone or download this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click on the **Load unpacked** button in the top left.
5. Select the `meet-extension` folder.

## 🛠️ Usage

1. **Start a Google Meet**: Join or start a new Google Meet session (`meet.google.com`). Make sure you have granted microphone permissions and your microphone is **unmuted**.
2. **Configure the API Key**: 
   - Click the extension puzzle piece icon in the Chrome toolbar.
   - Click the **Gemini AI Consultant** icon to open the popup.
   - Enter your Gemini API Key (e.g., from Google AI Studio) and click **Save Key**.
3. **Activate the Consultant**: 
   - In the same popup, click **Activate in Google Meet**.
   - A floating green badge will appear in the bottom-left corner of your Google Meet reading `AI Consultant: Listening 🎙️`.
4. **Talk to the AI**: Speak naturally into your microphone. The AI will hear you and respond within a few seconds. The audio will be broadcasted to all meeting participants.
5. **Mute/Unmute**: Click the floating badge at any time to toggle the AI between `Listening 🎙️` and `Muted 🔇`. When muted, your audio is not sent to the Gemini API, saving tokens and preventing the AI from interrupting.

## 🧠 How It Works (Architecture)

To allow other Google Meet participants to hear the AI, we use a technique called **WebRTC Interception**:

1. **Main World Interception (`interceptor.js`)**: 
   - The extension injects a script into Google Meet before the page loads.
   - It intercepts the browser's `navigator.mediaDevices.getUserMedia` function.
   - When Google Meet asks for your microphone, we create a custom `AudioContext` and a `MediaStreamAudioDestinationNode`. 
   - We route your physical microphone into this custom destination node, and return *that* modified node to Google Meet.
   - This allows us to dynamically inject audio into your microphone stream.

2. **Secure Communication (`content.js`)**:
   - The extension's isolated content script handles the connection to the Gemini WebSocket.
   - It securely retrieves your API key from `chrome.storage.local`.
   - A secure, encrypted `MessageChannel` is established between the isolated extension world and the main Google Meet world.

3. **Audio Routing**:
   - As you speak, the `AudioWorklet` captures raw 16kHz PCM audio chunks.
   - These chunks are sent securely through the `MessageChannel` to `content.js`, which forwards them to Gemini.
   - When Gemini replies, `content.js` receives the AI's 24kHz audio response and passes it back through the `MessageChannel`.
   - The `interceptor.js` decodes the audio and plays it into the custom `MediaStreamAudioDestinationNode`, making it audible to everyone in the Google Meet.

## 🔒 Security
Your Gemini API Key is never exposed to the DOM or the main window environment. It resides strictly within the isolated execution environment of the Chrome Extension, adhering to Manifest V3 security best practices.
