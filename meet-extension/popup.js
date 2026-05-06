document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const activateBtn = document.getElementById('activateBtn');
  const statusDiv = document.getElementById('status');

  // Load saved key
  chrome.storage.local.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  });

  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    chrome.storage.local.set({ geminiApiKey: key }, () => {
      statusDiv.textContent = 'Key saved!';
      setTimeout(() => statusDiv.textContent = '', 2000);
    });
  });

  // Check current state on load
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0 && tabs[0].url.includes('meet.google.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_STATE' }, (response) => {
        if (!chrome.runtime.lastError && response && response.isActive) {
          activateBtn.textContent = 'Deactivate in Google Meet';
          activateBtn.style.background = '#ef4444';
        }
      });
    }
  });

  activateBtn.addEventListener('click', () => {
    // 1. Trigger AudioContext resume in the MAIN world (user gesture)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length && tabs[0].url.includes('meet.google.com')) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            // This runs in the MAIN world where interceptor.js created the AudioContext
            if (window.meetGemini && typeof window.meetGemini.resume === 'function') {
              window.meetGemini.resume();
            }
          },
          world: 'MAIN'
        });
      }
    });

    // 2. Send message to the active tab to start/stop the consultant
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0 || !tabs[0].url.includes('meet.google.com')) {
        statusDiv.textContent = 'Please open Google Meet first!';
        statusDiv.style.color = '#ef4444';
        setTimeout(() => {
          statusDiv.textContent = '';
          statusDiv.style.color = '#22c55e';
        }, 3000);
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'TOGGLE_CONSULTANT' }, (response) => {
        if (chrome.runtime.lastError) {
          statusDiv.textContent = 'Please reload the Google Meet page.';
          statusDiv.style.color = '#ef4444';
          setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.style.color = '#22c55e';
          }, 3000);
        } else {
          if (response && response.isActive) {
             activateBtn.textContent = 'Deactivate in Google Meet';
             activateBtn.style.background = '#ef4444';
             statusDiv.textContent = 'Consultant activated!';
          } else {
             activateBtn.textContent = 'Activate in Google Meet';
             activateBtn.style.background = '#22c55e';
             statusDiv.textContent = 'Consultant deactivated!';
          }
          setTimeout(() => window.close(), 1000);
        }
      });
    });
  });
});
