/**
 * Popup logic for Div Capture Extension.
 * Handles the initial trigger for content script injection and communication.
 */

/**
 * Ensures the necessary content scripts and styles are injected into the target tab.
 * Note: manifest.json also declares these, but manual injection ensures they are 
 * present even if the extension was installed/reloaded after the tab was opened.
 */
async function injectContentScript(tabId) {
  // Inject the CSS styles for selection highlighting and Modals
  await chrome.scripting.insertCSS({
    target: { tabId: tabId },
    files: ['content/content.css']
  }).catch(err => console.log('CSS injection status:', err));
  
  // Inject the main content script logic
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content/content.js']
  }).catch(err => console.log('Script injection status:', err));
}

// 'Extract' button handler: starts selection mode in the current tab
document.getElementById('startSelection').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  await injectContentScript(tab.id);
  
  // Notify content script to activate the selection UI
  chrome.tabs.sendMessage(tab.id, { action: 'start_selection' });
  window.close();
});

// 'Multi-Site Hub' button handler: opens the history/routing modal
document.getElementById('openHub').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  await injectContentScript(tab.id);
  
  // Notify content script to display the routing hub
  chrome.tabs.sendMessage(tab.id, { action: 'open_hub' });
  window.close();
});

