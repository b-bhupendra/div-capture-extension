/**
 * Background script for Div Capture Extension.
 * Handles cross-tab communication, tab discovery, and focus management.
 */

// Listen for messages from content scripts and the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // Action: Find all tabs that have editable elements (inputs, textareas, etc.)
  if (request.action === 'get_editable_tabs') {
    chrome.tabs.query({}, async (tabs) => {
      const validTabs = [];
      const promises = tabs.map(tab => {
        // Skip browser-restricted URLs like chrome:// or edge://
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
          return Promise.resolve();
        }
        
        // Ping each tab to see if it has editable elements
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'check_editable' }, (response) => {
                // Ignore errors (e.g., content script not loaded in that tab)
                if (chrome.runtime.lastError) {
                    resolve();
                    return;
                }
                if (response && response.isEditable) {
                  validTabs.push({
                    id: tab.id,
                    title: tab.title,
                    favIconUrl: tab.favIconUrl
                  });
                }
                resolve();
            });
        });
      });

      // Wait for all tabs to report back
      await Promise.all(promises);
      sendResponse({ tabs: validTabs });
    });
    return true; // Keep message channel open for asynchronous sendResponse
  }

  // Action: Send captured text to a specific tab and trigger "paste & execute"
  if (request.action === 'send_to_tab') {
    const { tabId, text, additionalText, comboText } = request;
    
    // Switch to the target tab so the user sees the action
    chrome.tabs.update(tabId, { active: true }, (tab) => {
        // Ensure the window containing the tab is also focused
        if (tab && tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
        
        // Brief delay to allow the OS to finish window focus switching.
        // This is crucial for correctly identifying document.activeElement in the content script.
        setTimeout(() => {
            chrome.tabs.sendMessage(tabId, {
              action: 'paste_and_execute',
              text: text,
              additionalText: additionalText,
              comboText: comboText
            });
        }, 150);
    });
  }
});

// Broadcast a refresh event when tabs are updated or removed 
// to keep the Multi-Site Hub dropdowns in sync across all tabs.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        broadcastTabRefresh();
    }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    broadcastTabRefresh();
});

/**
 * Sends a message to all accessible tabs to refresh their tab list dropdowns.
 */
function broadcastTabRefresh() {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(t => {
            if (t.url && !t.url.startsWith('chrome://')) {
                chrome.tabs.sendMessage(t.id, { action: 'force_tabs_refresh' }).catch(() => {});
            }
        });
    });
}

