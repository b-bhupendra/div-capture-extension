/**
 * Div Extractor Action Recorder
 * Isolated module for recording user interactions (clicks + paste points).
 */
window.DivExtractorRecorder = (function() {
    let isRecording = false;
    let recordedActions = [];
    let overlay = null;

    /**
     * Generates a robust CSS selector for a DOM element.
     */
    function getSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        
        const path = [];
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            let selector = el.nodeName.toLowerCase();
            if (el.className && typeof el.className === 'string') {
                const classes = el.className.trim().split(/\s+/).filter(c => !c.startsWith('div-extractor-'));
                if (classes.length) {
                    selector += '.' + classes.map(c => CSS.escape(c)).join('.');
                }
            }
            
            // Add nth-child if neighbor with same tag exists
            let sib = el, nth = 1;
            while (sib = sib.previousElementSibling) if (sib.nodeName === el.nodeName) nth++;
            if (nth > 1) selector += `:nth-of-type(${nth})`;
            
            path.unshift(selector);
            el = el.parentNode;
            if (el.id) {
                path.unshift(`#${CSS.escape(el.id)}`);
                break;
            }
        }
        return path.join(' > ');
    }

    /**
     * Intercepts clicks and records them as actions.
     */
    function handleGlobalClick(e) {
        if (!isRecording) return;
        
        // Prevent clicking on the overlay itself from being recorded
        if (e.target.closest('#div-extractor-recorder-overlay')) return;

        e.preventDefault();
        e.stopPropagation();

        const selector = getSelector(e.target);
        recordedActions.push({
            type: 'click',
            selector: selector,
            tag: e.target.tagName.toLowerCase(),
            text: e.target.innerText?.substring(0, 20) || ''
        });

        updateOverlay();
        showFeedback(e.clientX, e.clientY);
    }

    /**
     * Shows a brief visual feedback at the click point.
     */
    function showFeedback(x, y) {
        const dot = document.createElement('div');
        dot.style.fixed = 'absolute';
        dot.style.left = `${x - 10}px`;
        dot.style.top = `${y - 10}px`;
        dot.style.width = '20px';
        dot.style.height = '20px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = 'rgba(217, 70, 239, 0.6)';
        dot.style.border = '2px solid white';
        dot.style.pointerEvents = 'none';
        dot.style.zIndex = '2147483647';
        dot.style.position = 'fixed';
        dot.style.transition = 'all 0.5s ease-out';
        
        document.body.appendChild(dot);
        
        requestAnimationFrame(() => {
            dot.style.transform = 'scale(2)';
            dot.style.opacity = '0';
            setTimeout(() => dot.remove(), 500);
        });
    }

    /**
     * Creates or updates the recording status overlay.
     */
    function createOverlay() {
        if (overlay) return;
        
        overlay = document.createElement('div');
        overlay.id = 'div-extractor-recorder-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(10, 10, 10, 0.9);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(139, 92, 246, 0.5);
            color: white;
            padding: 16px;
            border-radius: 12px;
            z-index: 2147483647;
            font-family: sans-serif;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 200px;
        `;

        const title = document.createElement('div');
        title.innerHTML = '<strong>✨ Recording Macro</strong>';
        overlay.appendChild(title);

        const list = document.createElement('div');
        list.id = 'div-extractor-action-list';
        list.style.fontSize = '12px';
        list.style.maxHeight = '150px';
        list.style.overflowY = 'auto';
        overlay.appendChild(list);

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '8px';

        const pastePointBtn = document.createElement('button');
        pastePointBtn.innerText = '📍 Add Paste Point';
        pastePointBtn.style.cssText = 'flex: 1; padding: 6px; border-radius: 6px; border: none; background: #6366f1; color: white; cursor: pointer; font-size: 11px;';
        pastePointBtn.onclick = () => {
            recordedActions.push({ type: 'paste' });
            updateOverlay();
        };

        const stopBtn = document.createElement('button');
        stopBtn.innerText = '✅ Save \u0026 Stop';
        stopBtn.style.cssText = 'flex: 1; padding: 6px; border-radius: 6px; border: none; background: #10b981; color: white; cursor: pointer; font-size: 11px; font-weight: 700;';
        stopBtn.onclick = stopRecording;

        btnGroup.appendChild(pastePointBtn);
        btnGroup.appendChild(stopBtn);
        overlay.appendChild(btnGroup);

        document.body.appendChild(overlay);
    }

    function updateOverlay() {
        const list = document.getElementById('div-extractor-action-list');
        if (!list) return;
        list.innerHTML = recordedActions.map((action, i) => `
            <div style="margin-bottom: 4px; color: #9ca3af;">
                ${i+1}. ${action.type === 'click' ? `Click ${action.tag}` : '📍 Paste Here'}
            </div>
        `).join('');
        list.scrollTop = list.scrollHeight;
    }

    /**
     * Starts the recording mode.
     */
    function startRecording() {
        isRecording = true;
        recordedActions = [];
        createOverlay();
        document.addEventListener('click', handleGlobalClick, true);
        window.divExtractorActive = true; 
    }

    /**
     * Stops the recording mode and sends the actions back to the hub.
     */
    function stopRecording() {
        isRecording = false;
        document.removeEventListener('click', handleGlobalClick, true);
        if (overlay) overlay.remove();
        overlay = null;

        // Send actions back to background script to route them to the Hub tab
        chrome.runtime.sendMessage({
            action: 'recording_complete',
            sequence: recordedActions
        });
        
        window.divExtractorActive = false;
    }

    // Listen for start recording command
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'start_recording') {
            startRecording();
        }
    });

    return {
        startRecording,
        stopRecording
    };
})();
