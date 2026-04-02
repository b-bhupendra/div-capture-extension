/**
 * Paste Assistant Content Script.
 * Automatically shows a 'Paste' button when user focuses on an editable field
 * if there is extracted text available in storage.
 */
(function() {
  let pasteBtn = null;
  let currentTarget = null;
  let hasExtractedText = false;
  let currentExtractedText = '';

  // Check if we have extracted text on initial load
  chrome.storage.local.get(['extractedText'], (result) => {
    if (result.extractedText) {
      hasExtractedText = true;
      currentExtractedText = result.extractedText;
    }
  });

  // Listen for storage changes to enable/disable the assistant dynamically
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.extractedText) {
      if (changes.extractedText.newValue) {
        hasExtractedText = true;
        currentExtractedText = changes.extractedText.newValue;
      } else {
        hasExtractedText = false;
        currentExtractedText = '';
        removePasteButton(); // Hide if text was cleared
      }
    }
  });

  // Triggered when any element is focused
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    
    // Only target inputs, textareas, or contenteditables
    if (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text') || target.isContentEditable) {
      if (hasExtractedText) {
        showPasteButton(target);
      }
    }
  });

  // Cleanup logic: hide button if user clicks elsewhere
  document.addEventListener('click', (e) => {
    if (pasteBtn && currentTarget && e.target !== currentTarget && !pasteBtn.contains(e.target)) {
        removePasteButton();
    }
  });

  // Remove button when window loses focus to avoid lingering UI artifacts
  window.addEventListener('blur', removePasteButton);

  /**
   * Creates and displays the 'Paste' button next to the focused element.
   */
  function showPasteButton(target) {
    if (!hasExtractedText) return;
    
    // Avoid re-creating if already attached to this target
    if (pasteBtn && currentTarget === target) return;
    
    removePasteButton();
    
    currentTarget = target;
    
    pasteBtn = document.createElement('button');
    pasteBtn.className = 'div-extractor-paste-assistant-btn';
    pasteBtn.innerText = 'Paste Extracted Text';
    pasteBtn.title = 'Paste text extracted by Div Extractor';
    
    // Initial position off-screen while we measure element dimensions
    pasteBtn.style.top = '-9999px';
    pasteBtn.style.left = '-9999px';

    pasteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pasteTextIntoTarget(currentTarget, currentExtractedText);
      currentTarget.focus(); 
    });
    
    document.body.appendChild(pasteBtn);
    // Use requestAnimationFrame to ensure the button is in the DOM for dimension calculations
    requestAnimationFrame(() => positionButton(target, pasteBtn));
    
    // Ensure the button stays aligned if the user scrolls or resizes the window
    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });
  }
  
  function updatePosition() {
      if (currentTarget && pasteBtn) {
          positionButton(currentTarget, pasteBtn);
      }
  }

  /**
   * Calculates the optimal floating position for the button relative to the target input.
   */
  function positionButton(target, button) {
    const rect = target.getBoundingClientRect();
    const btnRect = button.getBoundingClientRect();
    
    // Default: Hovering over the top right corner of the element
    let top = rect.top + window.scrollY - btnRect.height - 5;
    let left = rect.right + window.scrollX - btnRect.width;
    
    // Adjustment if the button would be clipped by the top of the viewport
    if (top < window.scrollY) {
      top = rect.bottom + window.scrollY + 5;
    }
    
    // Adjustment if the button would be clipped by the left of the viewport
    if (left < window.scrollX) {
      left = window.scrollX + 5;
    }
    
    button.style.top = top + 'px';
    button.style.left = left + 'px';
  }

  /**
   * Removes the button from the DOM and cleans up listeners.
   */
  function removePasteButton() {
    if (pasteBtn) {
      pasteBtn.remove();
      pasteBtn = null;
    }
    currentTarget = null;
    window.removeEventListener('scroll', updatePosition);
    window.removeEventListener('resize', updatePosition);
  }

  /**
   * Pastes text into an input, textarea, or contenteditable element while preserving undo history.
   */
  function pasteTextIntoTarget(target, text) {
    if (target.isContentEditable) {
      // document.execCommand('insertText') is used to support Undo/Redo history
      target.focus();
      document.execCommand('insertText', false, text);
    } else {
      // Standard input/textarea handling
      const startPos = target.selectionStart || 0;
      const endPos = target.selectionEnd || 0;
      const before = target.value.substring(0, startPos);
      const after = target.value.substring(endPos, target.value.length);
      
      target.value = before + text + after;
      
      // Keep/Update cursor position
      const newPos = startPos + text.length;
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(newPos, newPos);
      }
      
      // Trigger 'input' event so reactive frameworks (React, Vue) detect the change
      const event = new Event('input', { bubbles: true });
      target.dispatchEvent(event);
    }
  }

  // Handle messages from the background script (Discover tabs and Perform Hub actions)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Background script asks if this tab has editable fields
    if (request.action === 'check_editable') {
      const isEditable = !!document.querySelector('textarea, input[type="text"], [contenteditable="true"]');
      sendResponse({ isEditable: isEditable });
    }

    // Background script sends text to be pasted here from the Multi-Site Hub
    if (request.action === 'paste_and_execute') {
      const { text, additionalText, comboText } = request;
      const combined = text + (additionalText ? '\n\n' + additionalText : '');
      
      // Discovery: Find the best target to paste into
      // Priority: Focused element (if valid), then first visible editable element
      let target = document.querySelector(':focus');
      if (!target || !(target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text') || target.isContentEditable)) {
          const focusables = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]'));
          target = focusables.find(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) || focusables[0];
      }
      
      if (target) {
         pasteTextIntoTarget(target, combined);
         
         // If an auto-submit combo (like 'Enter') was specified, execute it
         if (comboText) {
             executeCombo(target, comboText);
         }
      }
    }
  });

  /**
   * Simulates a keyboard interaction (e.g., 'Enter', 'Ctrl+Enter') after pasting.
   * Useful for auto-submitting forms or triggering chat messages.
   */
  function executeCombo(target, comboText) {
      const parts = comboText.toLowerCase().split('+').map(p => p.trim());
      
      let key = 'Enter';
      let keyCode = 13;
      
      // Parse special keys
      if (parts.includes('space')) { key = ' '; keyCode = 32; }
      if (parts.includes('escape')) { key = 'Escape'; keyCode = 27; }
      if (parts.includes('tab')) { key = 'Tab'; keyCode = 9; }
      
      // Detect modifiers
      const modifiers = {
          ctrlKey: parts.includes('ctrl'),
          shiftKey: parts.includes('shift'),
          altKey: parts.includes('alt'),
          metaKey: parts.includes('meta') || parts.includes('cmd')
      };
      
      const eventOpts = { 
          bubbles: true, 
          cancelable: true,
          key: key,
          code: key === 'Enter' ? 'Enter' : key,
          keyCode: keyCode,
          which: keyCode,
          charCode: key === 'Enter' ? 13 : 0,
          ...modifiers
      };

      // Dispatch full series of keyboard events
      target.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
      target.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
      
      // Some React/Modern apps require specific input events for line breaks
      if (key === 'Enter' && !modifiers.shiftKey) {
          target.dispatchEvent(new InputEvent('input', {
              bubbles: true, cancelable: true, inputType: 'insertLineBreak'
          }));
      }
      
      target.dispatchEvent(new KeyboardEvent('keyup', eventOpts));

      // Attempt to find and click a submit button associated with the target
      try {
          if (target.form) {
             // Look for standard submit buttons or buttons with 'send' text
             const submitBtn = target.form.querySelector('button[type="submit"], input[type="submit"]')
                               || Array.from(target.form.querySelectorAll('button, input[type="button"]')).find(b => {
                                   const btnText = (b.textContent || b.value || '').toLowerCase();
                                   return btnText.includes('send') || btnText.includes('submit');
                               });
             if (submitBtn) {
                 submitBtn.click();
             } else if (key === 'Enter' && !modifiers.shiftKey) {
                 // Synthetic form submission if no button found
                 target.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                 try {
                     if (typeof target.form.submit === 'function') target.form.submit();
                 } catch (e) { /* ignore */ }
             }
          }
      } catch (e) {
          console.warn('Div Extractor Auto-submit failed:', e);
      }
  }

})();

