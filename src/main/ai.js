import OpenAI from 'openai'

export async function classifyText(text, apiKey, model = 'gpt-4o-mini') {
  if (!apiKey || !apiKey.trim()) return null

  const openai = new OpenAI({
    apiKey: apiKey.trim(),
  })

  const maxRetries = 3
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }

      const response = await openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a clipboard content classifier. Categorize the text into one or two tags (e.g. Code, URL, Email, Note, Citation). Return ONLY comma separated tags.'
          },
          { role: 'user', content: text.substring(0, 1000) }
        ],
        max_tokens: 50
      })

      return response.choices[0].message.content.split(',').map(t => t.trim())
    } catch (err) {
      lastError = err
      // Only retry on rate limit (429) or server errors (5xx)
      if (err.status === 429 || (err.status >= 500 && err.status < 600)) {
        console.warn(`AI Classification retry ${attempt + 1}/${maxRetries} (status ${err.status})`)
        continue
      }
      // Non-retryable error (401, 400, etc.) — break immediately
      break
    }
  }

  console.error('AI Classification Error:', {
    status: lastError?.status,
    code: lastError?.code,
    message: lastError?.message,
    model
  })
  return null
}
