/**
 * Div Extractor AI Processor
 * Isolates all logic for interacting with Chrome's Built-in AI (Prompt API).
 */
window.DivExtractorAI = (function() {
    
    /**
     * Checks if the Built-in AI Prompt API is available in this browser.
     * @returns {Promise<string>} 'readily', 'after-download', or 'no'
     */
    async function getAvailability() {
        try {
            if (!window.ai || !window.ai.languageModel) {
                return 'no';
            }
            const capabilities = await window.ai.languageModel.capabilities();
            return capabilities.available;
        } catch (e) {
            console.error('Div Extractor AI Availability Check failed:', e);
            return 'no';
        }
    }

    /**
     * Refines the provided text using Gemini Nano.
     * Removes noise, fixes formatting, and improves readability.
     * @param {string} text The raw extracted text
     * @param {Function} onProgress Optional callback for streamed responses
     * @returns {Promise<string>} The refined text
     */
    async function refineText(text, onProgress) {
        const availability = await getAvailability();
        
        if (availability === 'no') {
            throw new Error('Built-in AI is not supported on this browser version or hardware.');
        }

        let session;
        try {
            // Initialize the session with a specific system prompt for cleaning text
            session = await window.ai.languageModel.create({
                systemPrompt: `You are a text cleaning assistant. 
                Your goal is to take raw, messy text extracted from a webpage and:
                1. Remove boilerplate (e.g. "Click here", "Sponsored", "Menu").
                2. Fix typos and formatting artifacts.
                3. Structure the content with clear headers if missing.
                4. Maintain all original factual information. 
                Keep the output concise and highly readable.
                Do not add any conversational filler. Just return the cleaned text.`
            });

            const prompt = `Please clean and refine the following extracted text:\n\n${text}`;
            
            // If onProgress is provided, use the streaming API
            if (onProgress && typeof session.promptStreaming === 'function') {
                const stream = session.promptStreaming(prompt);
                let fullResponse = '';
                for await (const chunk of stream) {
                    fullResponse = chunk;
                    onProgress(fullResponse);
                }
                return fullResponse;
            } else {
                // Otherwise use the standard prompt API
                return await session.prompt(prompt);
            }
        } catch (e) {
            console.error('Div Extractor AI Refine failed:', e);
            throw e;
        } finally {
            if (session) {
                session.destroy();
            }
        }
    }

    return {
        getAvailability,
        refineText
    };
})();
