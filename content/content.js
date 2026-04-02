/**
 * Main content script for Div Extraction.
 * This script handles element selection, UI overlays, and communication with the background script.
 */

// Avoid multiple injections into the same page
if (typeof window.divExtractorActive === 'undefined') {
  // Global state for this tab
  window.divExtractorActive = false; // Whether we are currently in selection mode
  window.divExtractorSelectedElements = new Set(); // Currently selected DOM elements
  window.divExtractorRecordingCardId = null; // Track which card is being recorded
  
  // Listen for messages from the popup or background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Starts the element selection mode
    if (request.action === 'start_selection') {
      if (!window.divExtractorActive) {
        startSelectionMode();
      }
    }
    // Opens the history and routing hub
    if (request.action === 'open_hub') {
      showSendToModal();
    }
    // Forced refresh of the target tab dropdowns in the UI
    if (request.action === 'force_tabs_refresh') {
      updateAllTabDropdowns();
    }
    // Receives a recorded sequence from the recorder script (via background)
    if (request.action === 'save_recorded_sequence') {
        saveRecordedSequence(request.sequence);
    }
  });

  /**
   * Refreshes the 'Target Tab' dropdowns in the open modal when tabs change elsewhere.
   */
  function updateAllTabDropdowns() {
    const modal = document.getElementById('div-extractor-send-modal');
    if (!modal) return;

    chrome.runtime.sendMessage({ action: 'get_editable_tabs' }, (response) => {
      const tabs = (response && response.tabs) ? response.tabs : [];
      const selects = modal.querySelectorAll('.div-extractor-target-select');
      
      selects.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '';
        
        if (tabs.length === 0) {
          const opt = document.createElement('option');
          opt.innerText = 'No valid tabs open';
          select.appendChild(opt);
          select.disabled = true;
        } else {
          select.disabled = false;
          tabs.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.innerText = t.title.substring(0, 40);
            if (t.id.toString() === currentVal) opt.selected = true;
            select.appendChild(opt);
          });
        }
      });
    });
  }

  /**
   * Enables selection mode: highlights elements on hover and picks them on click.
   */
  function startSelectionMode() {
    window.divExtractorActive = true;
    window.divExtractorSelectedElements.clear(); // Reset selections on start

    // Add event listeners (use capture phase to intercept clicks before they trigger site logic)
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
    
    // Inject the Floating Action Button (FAB) UI
    createFab();
  }

  /**
   * Disables selection mode and cleans up UI/listeners.
   */
  function stopSelectionMode() {
    window.divExtractorActive = false;
    
    // Remove event listeners
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    
    // Cleanup visual highlights
    document.querySelectorAll('.div-extractor-hover').forEach(el => {
      el.classList.remove('div-extractor-hover');
    });
    document.querySelectorAll('.div-extractor-selected').forEach(el => {
      el.classList.remove('div-extractor-selected');
    });
    
    // Remove the FAB
    const fab = document.getElementById('div-extractor-fab-container');
    if (fab) fab.remove();
    
    window.divExtractorSelectedElements.clear();
  }

  /**
   * Highlights valid container elements when hovered.
   */
  function handleMouseOver(e) {
    if (!window.divExtractorActive) return;
    
    const target = e.target;
    // Highlight elements that are block level containers
    if (target.tagName === 'DIV' || target.tagName === 'SECTION' || target.tagName === 'ARTICLE' || target.tagName === 'MAIN' || target.tagName === 'ASIDE' || target.tagName === 'P') {
      target.classList.add('div-extractor-hover');
    }
  }

  /**
   * Removes highlight when mouse leaves an element.
   */
  function handleMouseOut(e) {
    if (!window.divExtractorActive) return;
    const target = e.target;
    target.classList.remove('div-extractor-hover');
  }

  /**
   * Selects or deselects an element when clicked during selection mode.
   */
  function handleClick(e) {
    if (!window.divExtractorActive) return;
    
    const target = e.target;
    
    // We only interact with block-level elements
    if (target.tagName === 'DIV' || target.tagName === 'SECTION' || target.tagName === 'ARTICLE' || target.tagName === 'MAIN' || target.tagName === 'ASIDE' || target.tagName === 'P') {
        e.preventDefault();
        e.stopPropagation();

        if (target.classList.contains('div-extractor-selected')) {
          target.classList.remove('div-extractor-selected');
          window.divExtractorSelectedElements.delete(target);
        } else {
          target.classList.add('div-extractor-selected');
          window.divExtractorSelectedElements.add(target);
        }
        
        updateFabCount();
    }
  }

  /**
   * Creates the floating UI container with 'Extract' and 'Cancel' buttons.
   */
  function createFab() {
    // Remove old if exists
    const old = document.getElementById('div-extractor-fab-container');
    if (old) old.remove();

    const container = document.createElement('div');
    container.id = 'div-extractor-fab-container';
    
    const countText = document.createElement('span');
    countText.id = 'div-extractor-count';
    countText.innerText = '0 selected';
    
    const captureBtn = document.createElement('button');
    captureBtn.className = 'div-extractor-btn';
    captureBtn.innerText = 'Extract \u0026 Copy';
    captureBtn.onclick = extractAndCopy;
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'div-extractor-btn div-extractor-btn-cancel';
    cancelBtn.innerText = 'Cancel';
    cancelBtn.onclick = stopSelectionMode;
    
    container.appendChild(countText);
    container.appendChild(captureBtn);
    container.appendChild(cancelBtn);
    
    document.body.appendChild(container);
  }

  /**
   * Updates the text showing many elements are currently selected.
   */
  function updateFabCount() {
    const count = window.divExtractorSelectedElements.size;
    const countText = document.getElementById('div-extractor-count');
    if (countText) {
      countText.innerText = `${count} selected`;
    }
  }

  /**
   * Basic text cleanup: remove empty lines and trim whitespace.
   */
  function checkAndClean(text) {
      return text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n');
  }

  /**
   * Main function to extract text from selected elements, save to history, and copy to clipboard.
   */
  async function extractAndCopy() {
    if (window.divExtractorSelectedElements.size === 0) {
      showToast('Select at least one section first!', '#ef4444');
      return;
    }

    let extractedText = '';
    
    let idx = 1;
    for (const el of window.divExtractorSelectedElements) {
       // .innerText is preferred as it respects CSS layout and skips script/style tags
       let textContent = el.innerText || el.textContent || '';
       let cleaned = checkAndClean(textContent);
       if (cleaned) {
           extractedText += `--- Section ${idx} ---\n${cleaned}\n\n`;
           idx++;
       }
    }
    
    extractedText = extractedText.trim();

    // Create a history entry
    const newEntry = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        url: window.location.href,
        title: document.title,
        text: extractedText,
        timestamp: Date.now()
    };
    
    try {
      // Update the current snippet for the immediate 'Paste Assistant'
      await chrome.storage.local.set({ extractedText: extractedText });
      
      // Update history list
      const data = await chrome.storage.local.get(['extractionHistory']);
      let history = data.extractionHistory || [];
      history.push(newEntry);
      
      // Limit history to last 20 items to prevent storage bloat
      if (history.length > 20) history = history.slice(history.length - 20);
      
      await chrome.storage.local.set({ extractionHistory: history });
    } catch (e) {
      console.log('Could not save to local storage history: ', e);
    }

    // Try to copy to clipboard
    try {
      await navigator.clipboard.writeText(extractedText);
      showToast('Copied to clipboard!', '#10b981');
      
      stopSelectionMode();
      showSendToModal(); // Auto-open the hub after successful copy
    } catch (err) {
      console.error('Failed to copy: ', err);
      // Fallback to older execCommand method if modern API fails
      if (copyFallback(extractedText)) {
         showToast('Copied to clipboard!', '#10b981');
         stopSelectionMode();
         showSendToModal();
      } else {
         showToast('Copy failed. Check extensions permissions.', '#ef4444');
      }
    }
  }

  let activeReactivityListener = null;

  /**
   * Displays the Multi-Site Hub modal where users can manage history and route text to other tabs.
   */
  function showSendToModal() {
      closeHubModal(); 

      showToast('Loading Multi-Site Hub...', '#3b82f6');
      
      // Load history and discover valid tabs
      chrome.storage.local.get(['extractionHistory'], (data) => {
          let history = data.extractionHistory || [];
          
          chrome.runtime.sendMessage({ action: 'get_editable_tabs' }, (response) => {
              const tabs = (response && response.tabs) ? response.tabs : [];
              if (tabs.length === 0) {
                  showToast('No external tabs found with text inputs.', '#ef4444');
              }
              buildSendToUI(history, tabs);
              
              // Enable cross-tab reactivity: if history changes (e.g. from another tab), reflect it here immediately
              activeReactivityListener = (changes, namespace) => {
                  if (namespace === 'local' && changes.extractionHistory) {
                      const newHistory = changes.extractionHistory.newValue || [];
                      const listContainer = document.getElementById('div-extractor-history-list');
                      if (listContainer) {
                          // Remove DOM elements that are no longer in storage
                          const storeIds = newHistory.map(h => h.id);
                          Array.from(listContainer.children).forEach(child => {
                              if (!storeIds.includes(child.dataset.id)) {
                                  child.remove();
                              }
                          });
                          
                          // Update existing cards or append new ones
                          newHistory.forEach(item => {
                              const existingCard = document.getElementById('extractor-card-' + item.id);
                              if (existingCard) {
                                  // Update text preview if content changed
                                  const preview = existingCard.querySelector('.div-extractor-history-card-text.preview-only');
                                  if (preview && preview.dataset.original !== item.text) {
                                      preview.innerText = item.text.substring(0, 400) + (item.text.length > 400 ? '...' : '');
                                      preview.dataset.original = item.text;
                                  }
                              } else {
                                  // This is a new extraction from another tab, add it to our view
                                  listContainer.appendChild(createCardDOM(item, newHistory, tabs));
                              }
                          });
                      }
                  }
              };
              chrome.storage.onChanged.addListener(activeReactivityListener);
          });
      });
  }

  /**
   * Removes the Hub modal and cleans up the storage listener.
   */
  function closeHubModal() {
      const old = document.getElementById('div-extractor-send-modal');
      if (old) old.remove();
      if (activeReactivityListener) {
          chrome.storage.onChanged.removeListener(activeReactivityListener);
          activeReactivityListener = null;
      }
  }

  /**
   * Constructs the main Hub DOM structure.
   */
  function buildSendToUI(history, tabs) {
      const overlay = document.createElement('div');
      overlay.id = 'div-extractor-send-modal';
      
      const content = document.createElement('div');
      content.className = 'div-extractor-modal-content';
      
      const topBar = document.createElement('div');
      topBar.style.display = 'flex';
      topBar.style.justifyContent = 'space-between';
      topBar.style.alignItems = 'center';
      
      const title = document.createElement('h2');
      title.innerText = 'Multi-Site Hub';
      
      // Button to combine multiple snippet cards into one
      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'div-extractor-btn';
      mergeBtn.innerText = 'Merge Selected Cards';
      mergeBtn.onclick = () => handleMerge(history);
      
      topBar.appendChild(title);
      topBar.appendChild(mergeBtn);
      
      const historyList = document.createElement('div');
      historyList.id = 'div-extractor-history-list';
      historyList.className = 'div-extractor-history-list';
      historyList.style.marginTop = '24px';
      
      if (history.length === 0) {
          historyList.innerText = 'History is empty. Select some divs to extract!';
          historyList.className = 'div-extractor-history-empty';
      }
      
      // Create a card for each historical snippet
      history.forEach(item => {
          historyList.appendChild(createCardDOM(item, history, tabs));
      });
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'div-extractor-btn div-extractor-btn-cancel';
      closeBtn.innerText = 'Close Hub';
      closeBtn.style.marginTop = '20px';
      closeBtn.style.alignSelf = 'center';
      closeBtn.onclick = () => {
          closeHubModal();
          stopSelectionMode();
      };
      
      content.appendChild(topBar);
      content.appendChild(historyList);
      content.appendChild(closeBtn);
      
      overlay.appendChild(content);
      document.body.appendChild(overlay);
  }

  /**
   * Creates the DOM for a single snippet card in the history list.
   */
  function createCardDOM(item, historyArray, tabs) {
      const card = document.createElement('div');
      card.className = 'div-extractor-history-card';
      card.id = 'extractor-card-' + item.id;
      card.dataset.id = item.id;
      
      // Header: checkbox + title
      const header = document.createElement('div');
      header.className = 'div-extractor-card-header';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'div-extractor-card-checkbox';
      
      const cardTitle = document.createElement('div');
      cardTitle.className = 'div-extractor-history-card-title';
      cardTitle.innerText = item.title || item.url || 'Unknown Site';
      cardTitle.style.flex = '1';
      cardTitle.style.marginLeft = '8px';
      
      // Text preview box (Preview only, opens full editor modal on click)
      const cardText = document.createElement('div');
      cardText.className = 'div-extractor-history-card-text preview-only';
      cardText.dataset.original = item.text; // Store original for reactivity comparison
      cardText.innerText = item.text.substring(0, 400) + (item.text.length > 400 ? '...' : '');
      cardText.onclick = () => showTextEditorModal(item, historyArray);
      
      // Status Badges (Current Tab, Merged, etc.)
      const badgeContainer = document.createElement('div');
      badgeContainer.className = 'div-extractor-badge-container';
      
      if (item.url === window.location.href) {
          const currentBadge = document.createElement('span');
          currentBadge.className = 'div-extractor-badge badge-current';
          currentBadge.innerText = 'Current Tab';
          badgeContainer.appendChild(currentBadge);
      }
      
      if (item.isMerged) {
          const mergedBadge = document.createElement('span');
          mergedBadge.className = 'div-extractor-badge badge-merged';
          mergedBadge.innerText = 'Merged';
          badgeContainer.appendChild(mergedBadge);
      }
      
      if (item.isAIRefined) {
          const aiBadge = document.createElement('span');
          aiBadge.className = 'div-extractor-badge badge-ai';
          aiBadge.innerText = 'AI Refined';
          badgeContainer.appendChild(aiBadge);
      }
      
      // Header Row including checkbox, title, and badges
      const titleRow = document.createElement('div');
      titleRow.style.display = 'flex';
      titleRow.style.alignItems = 'center';
      titleRow.style.width = '100%';
      titleRow.appendChild(checkbox);
      titleRow.appendChild(cardTitle);

      header.style.flexDirection = 'column';
      header.style.alignItems = 'flex-start';
      header.appendChild(titleRow);
      header.appendChild(badgeContainer);
      
      // Dropdown to select which tab to send this text to
      const selectLabel = document.createElement('label');
      selectLabel.innerText = 'Target Tab:';
      const targetSelect = document.createElement('select');
      targetSelect.className = 'div-extractor-target-select';
      if (tabs.length === 0) {
          const opt = document.createElement('option');
          opt.innerText = 'No valid tabs open';
          targetSelect.appendChild(opt);
          targetSelect.disabled = true;
      } else {
          tabs.forEach(t => {
              const opt = document.createElement('option');
              opt.value = t.id;
              opt.innerText = t.title.substring(0, 40);
              targetSelect.appendChild(opt);
          });
      }
      
      // Optional additional text to append during routing
      const extraLabel = document.createElement('label');
      extraLabel.innerText = 'Additional Text:';
      const extraInput = document.createElement('textarea');
      extraInput.placeholder = 'Append specifically to this...';
      extraInput.className = 'div-extractor-extra-input';
      extraInput.style.height = '40px';
      
      // Keyboard combo to trigger after pasting (e.g. 'Enter' to auto-submit)
      const comboLabel = document.createElement('label');
      comboLabel.innerText = 'Auto-submit Combo:';
      const comboInput = document.createElement('input');
      comboInput.type = 'text';
      comboInput.value = 'Enter';
      comboInput.className = 'div-extractor-combo-input';
      
      // Action Sequence Display
      const sequenceLabel = document.createElement('label');
      sequenceLabel.innerText = 'Action Sequence:';
      const sequenceList = document.createElement('div');
      sequenceList.className = 'div-extractor-sequence-list';
      if (item.sequence && item.sequence.length > 0) {
          sequenceList.innerHTML = item.sequence.map((s, i) => 
              `<div class="div-extractor-sequence-item">${i+1}. ${s.type === 'click' ? `Click ${s.tag}` : '📍 Paste'}</div>`
          ).join('');
      } else {
          sequenceList.innerText = 'No actions recorded. Default: Paste then Combo.';
          sequenceList.style.fontSize = '11px';
          sequenceList.style.color = '#6b7280';
      }

      const recordBtn = document.createElement('button');
      recordBtn.innerText = '⏺ Record Sequence';
      recordBtn.className = 'div-extractor-btn';
      recordBtn.style.background = '#ef4444';
      recordBtn.style.fontSize = '11px';
      recordBtn.style.marginTop = '8px';
      if (tabs.length === 0) recordBtn.disabled = true;
      recordBtn.onclick = () => startRecordingForCard(item.id, targetSelect.value);

      // Action buttons: Remove and Send
      const cardActions = document.createElement('div');
      cardActions.className = 'div-extractor-history-card-actions';
      
      const removeBtn = document.createElement('button');
      removeBtn.innerText = 'Remove';
      removeBtn.className = 'div-extractor-btn div-extractor-btn-cancel';
      removeBtn.style.fontSize = '12px';
      removeBtn.onclick = () => {
          const idx = historyArray.findIndex(h => h.id === item.id);
          if (idx > -1) {
              historyArray.splice(idx, 1);
              chrome.storage.local.set({ extractionHistory: historyArray });
          }
      };
      
      const sendBtn = document.createElement('button');
      sendBtn.innerText = 'Send';
      sendBtn.className = 'div-extractor-btn';
      sendBtn.style.fontSize = '12px';
      if (tabs.length === 0) sendBtn.disabled = true;
      
      sendBtn.onclick = () => {
          if (tabs.length === 0) return;
          const targetId = parseInt(targetSelect.value, 10);
          chrome.runtime.sendMessage({
              action: 'send_to_tab',
              tabId: targetId,
              text: item.text, // Use original full text, not preview
              additionalText: extraInput.value.trim(),
              comboText: comboInput.value.trim(),
              sequence: item.sequence
          });
          
          closeHubModal();
          stopSelectionMode();
      };
      
      const aiBtn = document.createElement('button');
      aiBtn.innerText = '✨ AI Refine';
      aiBtn.className = 'div-extractor-btn div-extractor-btn-ai';
      aiBtn.style.fontSize = '12px';
      aiBtn.onclick = () => handleAIRefine(item, card);
      
      cardActions.appendChild(removeBtn);
      cardActions.appendChild(aiBtn); // Insert AI btn between remove and send
      cardActions.appendChild(sendBtn);
      
      card.appendChild(header);
      card.appendChild(cardText);
      card.appendChild(selectLabel);
      card.appendChild(targetSelect);
      card.appendChild(extraLabel);
      card.appendChild(extraInput);
      card.appendChild(comboLabel);
      card.appendChild(comboInput);
      card.appendChild(sequenceLabel);
      card.appendChild(sequenceList);
      card.appendChild(recordBtn);
      card.appendChild(cardActions);
      
      return card;
  }

  /**
   * Handles the AI refinement process for a specific history card.
   */
  async function handleAIRefine(item, card) {
      if (!window.DivExtractorAI) {
          showToast('AI Processor not correctly loaded.', '#ef4444');
          return;
      }

      const availability = await window.DivExtractorAI.getAvailability();
      if (availability === 'no') {
          showToast('Built-in AI is not supported on this browser version.', '#ef4444');
          return;
      }

      const cardText = card.querySelector('.div-extractor-history-card-text');
      const originalBtnText = card.querySelector('.div-extractor-btn-ai').innerText;
      const aiBtn = card.querySelector('.div-extractor-btn-ai');

      try {
          // Enter loading state
          card.classList.add('div-extractor-ai-processing');
          aiBtn.innerText = '✨ Refining...';
          aiBtn.disabled = true;

          const refined = await window.DivExtractorAI.refineText(item.text, (partial) => {
              // Update preview in real-time if desired, or just wait for full
              if (cardText) {
                  cardText.innerText = partial.substring(0, 400) + (partial.length > 400 ? '...' : '');
              }
          });

          // Update data
          item.text = refined;
          item.isAIRefined = true;
          
          // Save back to storage
          chrome.storage.local.get(['extractionHistory'], (data) => {
              let history = data.extractionHistory || [];
              const idx = history.findIndex(h => h.id === item.id);
              if (idx > -1) {
                  history[idx] = item;
                  chrome.storage.local.set({ extractionHistory: history });
              }
          });

          showToast('Refined with AI!', '#8b5cf6');
      } catch (err) {
          console.error('AI Refinement failed:', err);
          showToast('AI Refinement failed. Try again later.', '#ef4444');
      } finally {
          card.classList.remove('div-extractor-ai-processing');
          aiBtn.innerText = originalBtnText;
          aiBtn.disabled = false;
      }
  }

  /**
   * Switches to the target tab and starts the recording mode there.
   */
  function startRecordingForCard(cardId, targetTabId) {
      window.divExtractorRecordingCardId = cardId;
      showToast('Switching to target tab to record...', '#3b82f6');
      
      chrome.tabs.sendMessage(parseInt(targetTabId, 10), { action: 'start_recording' }, (response) => {
          if (chrome.runtime.lastError) {
              console.log('Error starting recording:', chrome.runtime.lastError);
          }
          // The background script will handle the tab switch as part of the normal flow if we triggered it there,
          // but for now we'll just rely on the user manually switching if needed, or we can force it.
          chrome.runtime.sendMessage({
              action: 'send_to_tab',
              tabId: parseInt(targetTabId, 10),
              text: 'REC_MODE' // Special flag or just ignored
          });
      });
  }

  /**
   * Saves the recorded sequence into the specific history item.
   */
  function saveRecordedSequence(sequence) {
      if (!window.divExtractorRecordingCardId) return;
      
      chrome.storage.local.get(['extractionHistory'], (data) => {
          let history = data.extractionHistory || [];
          const idx = history.findIndex(h => h.id === window.divExtractorRecordingCardId);
          if (idx > -1) {
              history[idx].sequence = sequence;
              chrome.storage.local.set({ extractionHistory: history }, () => {
                  showToast('Sequence saved to card!', '#10b981');
                  window.divExtractorRecordingCardId = null;
              });
          }
      });
  }

  /**
   * Opens an overlay to edit the full text of a snippet.
   */
  function showTextEditorModal(item, historyArray) {
      const overlay = document.createElement('div');
      overlay.id = 'div-extractor-editor-overlay';
      overlay.className = 'div-extractor-editor-modal';
      
      const content = document.createElement('div');
      content.className = 'div-extractor-editor-content';
      
      const title = document.createElement('h2');
      title.innerText = 'Edit Extraction';
      
      const textArea = document.createElement('textarea');
      textArea.className = 'div-extractor-editor-textarea';
      textArea.value = item.text;
      
      const actions = document.createElement('div');
      actions.className = 'div-extractor-editor-actions';
      
      const saveBtn = document.createElement('button');
      saveBtn.className = 'div-extractor-btn';
      saveBtn.innerText = 'Save Changes';
      saveBtn.onclick = () => {
          const idx = historyArray.findIndex(h => h.id === item.id);
          if (idx > -1) {
              historyArray[idx].text = textArea.value;
              chrome.storage.local.set({ extractionHistory: historyArray });
              showToast('Changes saved!', '#10b981');
          }
          overlay.remove();
      };
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'div-extractor-btn div-extractor-btn-cancel';
      closeBtn.innerText = 'Close Without Saving';
      closeBtn.onclick = () => overlay.remove();
      
      actions.appendChild(closeBtn);
      actions.appendChild(saveBtn);
      
      content.appendChild(title);
      content.appendChild(textArea);
      content.appendChild(actions);
      overlay.appendChild(content);
      
      document.body.appendChild(overlay);
  }

  
  /**
   * Merges all currently checked snippet cards in the Hub into a single new entry.
   */
  function handleMerge(history) {
      const container = document.getElementById('div-extractor-history-list');
      if (!container) return;
      
      const checkboxes = container.querySelectorAll('.div-extractor-card-checkbox');
      let mergedText = '';
      
      checkboxes.forEach((cb) => {
          if (cb.checked) {
              const card = cb.closest('.div-extractor-history-card');
              // We use the 'dataset.original' to get the full text if available, or just read from preview
              const textArea = card.querySelector('.div-extractor-history-card-text');
              const itemFullText = textArea ? (textArea.dataset.original || textArea.value) : '';
              
              if (itemFullText.trim()) {
                  mergedText += itemFullText.trim() + '\n\n---\n\n';
              }
              // Reset checkbox after merge
              cb.checked = false;
          }
      });
      
      if (!mergedText) {
          showToast('Select at least one card to merge!', '#ef4444');
          return;
      }
      
      const newEntry = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          url: 'Merged Data',
          title: 'Custom Merged Snippet',
          text: mergedText.trim(),
          isMerged: true,
          timestamp: Date.now()
      };
      
      history.push(newEntry);
      chrome.storage.local.set({ extractionHistory: history });
      showToast('Cards merged successfully!', '#10b981');
  }

  /**
   * Legacy copy method using a hidden textarea.
   */
  function copyFallback(text) {
      try {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const result = document.execCommand("copy");
          document.body.removeChild(textarea);
          return result;
      } catch (e) {
          return false;
      }
  }

  /**
   * Displays a temporary notification at the bottom of the screen.
   */
  function showToast(message, bgColor) {
    const old = document.getElementById('div-extractor-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'div-extractor-toast';
    toast.innerText = message;
    if (bgColor) {
        toast.style.setProperty('background', bgColor, 'important');
    }
    
    document.body.appendChild(toast);
    
    // Animate out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}
