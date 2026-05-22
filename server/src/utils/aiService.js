const OpenAI = require('openai');
require('dotenv').config();

let openai = null;
if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
}

/**
 * Summarize and translate team updates to Bangla using OpenAI
 * @param {string} englishUpdates - Combined text of all team updates
 * @returns {Promise<string>} - Summarized Bangla text
 */
const summarizeToBangla = async (englishUpdates, dateStr) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
        console.warn('[AIService] OPENAI_API_KEY not found or empty in .env');
        return englishUpdates;
    }

    if (!englishUpdates || englishUpdates.trim() === '') {
        console.warn('[AIService] Empty englishUpdates provided for summarization. Skipping.');
        return 'No activities found for this date.';
    }

    // Basic format check
    if (!apiKey.startsWith('sk-')) {
        console.warn('[AIService] OPENAI_API_KEY in .env does not start with "sk-". It might be invalid.');
    }

    // Format dateStr to DD-MM-YY if possible, otherwise use as is
    let formattedDate = dateStr;
    try {
        if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [year, month, day] = dateStr.split('-');
            formattedDate = `${day}-${month}-${year.slice(2)}`;
        }
    } catch (e) {
        // ignore format error
    }

    const prompt = `Act as a Team Coordinator for a Bangladeshi software team.
Input: A list of daily task updates in English.
Output: A strictly formatted Bangla report.

**STRICT RESPONSE FORMAT:**
Report for ${formattedDate || 'Unknown Date'}
{Name}
{Summary in Bangla, Third Person}

{Name}
{Summary in Bangla, Third Person}

(Repeat for all users. Leave EXACTLY one blank line between users. NO conversational filler like "Here is the report".)

**RULES:**
1. **Script:** Bangla script (বাংলা). NO Banglish.
2. **Names:** English script.
3. **Tone:** Natural Choltibhasha.
4. **Third Person:** "Tasve did this", NOT "I did this".

**Input Data:**
${englishUpdates}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are a strict report generator. Output ONLY the report content."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenAI Error:', error);
        return englishUpdates; // Fallback to original if AI fails
    }
};

/**
 * Translate an existing report to Bangla while preserving structure.
 * @param {string} reportContent - The full report text (including manual edits)
 * @returns {Promise<string>} - The translated report
 */
const translateReportToBangla = async (reportContent) => {
    if (!reportContent || reportContent.trim() === '') {
        console.warn('[AIService] Empty report content provided for translation. Skipping.');
        return '';
    }

    const prompt = `Translate the following daily report to Bangla.
**CRITICAL RULES:**
1. **Preserve Structure:** Keep all line breaks, spacing, and formatting EXACTLY as is.
2. **Preserve Names/Keywords:** Keep user names and specific status keywords (like "Verified", "Done") in English if they look like metadata.
3. **Language:** Bangla script (বাংলা). Natural Choltibhasha.
4. **Content:** Translate the sentences accurately.

**Input Report:**
${reportContent}`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a precise translator. Output ONLY the translated content." },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenAI Translation Error:', error);
        return reportContent;
    }
};

/**
 * Paraphrase a single task summary into natural Bangla for Admin notifications.
 * @param {string} username - Name of the employee
 * @param {string} taskContent - The task summary content
 * @returns {Promise<string>} - The paraphrased Bangla text
 */
const paraphraseTaskForAdmin = async (username, taskContent) => {
    if (!process.env.OPENAI_API_KEY) return `${username} has submitted a task: ${taskContent}`;
    if (!taskContent || taskContent.trim() === '') return `${username} provided an empty update.`;

    const prompt = `Act as an AI Assistant for a Bangladeshi software company founder.
You just received a task update from an employee. Paraphrase it into very natural, professional yet friendly Bangla (Choltibhasha) for the founder to read.

Employee: ${username}
English Task: ${taskContent}

STRICT RULES:
1. Use Bangla script (বাংলা).
2. Keep the employee name in English.
3. Be concise.
4. Use Third Person (e.g., "${username} has finished X").
5. Do not add any conversational filler like "Here is the summary".
6. If the task is technical, you can keep some technical terms in English (e.g., "API", "UI", "Database") but write them in Bangla script if possible or keep in English if common.

Example Output:
${username} আজ API ইন্টিগ্রেশন এবং ড্যাশবোর্ডের কিছু UI চেঞ্জ শেষ করেছেন।`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "You are a helpful assistant that paraphrases work updates into natural Bangla." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
        });
        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('OpenAI Paraphrase Error:', error);
        return `${username} task update: ${taskContent}`;
    }
};

module.exports = {
    summarizeToBangla,
    translateReportToBangla,
    paraphraseTaskForAdmin
};
