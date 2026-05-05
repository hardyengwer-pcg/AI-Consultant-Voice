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
badge.textContent = 'AI Consultant: Active 🎙️';
document.body.appendChild(badge);

let isActive = false;

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
        badge.style.display = isActive ? 'block' : 'none';
        
        // Bridge the command to the MAIN world script
        window.postMessage({
          type: 'TOGGLE_CONSULTANT',
          apiKey: result.geminiApiKey,
          forceState: isActive
        }, '*');
        sendResponse({ status: 'ok', isActive: isActive });
      } else {
        alert("Please set your Gemini API Key in the extension popup first.");
        sendResponse({ status: 'error' });
      }
    });
    return true; // Keep message channel open for async response
  }
});
