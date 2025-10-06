
import logging
import openai
from . import config as app_config

# The google.generativeai library will be imported only if needed,
# to avoid errors if it's not installed.


def _build_prompt(text_content: str) -> str:
    """Builds a standardized prompt for text classification."""
    # Truncate content to avoid exceeding token limits
    truncated_content = text_content[:2500]
    
    # Define the allowed tags for the model
    allowed_tags_str = ", ".join(app_config.ALLOWED_TAGS)

    prompt = f"""You are an expert content classifier. Your task is to analyze the following text and assign one or more relevant tags from a predefined list.

RULES:
1. Respond ONLY with the chosen tags, separated by a comma.
2. You MUST choose from this list of allowed tags: {allowed_tags_str}
3. If no specific tag fits well, use the "General" tag.
4. Analyze the content carefully. For code, identify the language. For text, identify its purpose (e.g., citation, note).

TEXT TO CLASSIFY:
---
{truncated_content}
---

TAGS:"""
    return prompt

def _parse_response(response_text: str) -> list[str]:
    """Cleans and parses the comma-separated string from the LLM response."""
    if not response_text:
        return []
    
    tags = [tag.strip() for tag in response_text.split(',')]
    
    # Filter out any empty strings and ensure tags are in the allowed list for consistency
    valid_tags = [tag for tag in tags if tag and tag in app_config.ALLOWED_TAGS]
    
    if not valid_tags:
        logging.warning(f"LLM returned tags, but none are in the allowed list: {tags}")
        return ["Uncategorized"] # Fallback tag
        
    return valid_tags

def classify_with_openai(prompt: str, settings: dict) -> str:
    """Handles classification using the OpenAI API."""
    client = openai.OpenAI(
        api_key=settings.get('ai_api_key'), 
        base_url=settings.get('ai_base_url') or None # Handles empty string
    )
    response = client.chat.completions.create(
        model=settings.get('ai_model_name'),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=50,
    )
    return response.choices[0].message.content

def classify_with_gemini(prompt: str, settings: dict) -> str:
    """Handles classification using the Google Gemini API."""
    try:
        import google.generativeai as genai
    except ImportError:
        logging.critical("The 'google-generativeai' library is not installed. Please run 'pip install google-generativeai'")
        raise

    genai.configure(api_key=settings.get('ai_api_key'))
    model = genai.GenerativeModel(settings.get('ai_model_name'))
    response = model.generate_content(prompt)
    return response.text

def classify_and_tag(text_content: str, settings: dict) -> list[str] | None:
    """
    Classifies text using the configured AI provider and returns a list of tags.
    """
    provider = settings.get('ai_provider')
    if not all([provider, settings.get('ai_api_key'), settings.get('ai_model_name')]):
        logging.warning("AI classification skipped: provider, API key, or model name is missing in settings.")
        return None

    prompt = _build_prompt(text_content)
    response_text = ""
    
    try:
        if provider == "OpenAI":
            logging.info(f"Classifying with OpenAI model: {settings.get('ai_model_name')}")
            response_text = classify_with_openai(prompt, settings)

        elif provider == "Gemini":
            logging.info(f"Classifying with Gemini model: {settings.get('ai_model_name')}")
            response_text = classify_with_gemini(prompt, settings)
            
        else:
            logging.error(f"Unsupported AI provider in settings: {provider}")
            return None

        logging.info(f"AI response received: '{response_text}'")
        tags = _parse_response(response_text)
        logging.info(f"Parsed tags: {tags}")
        return tags

    except Exception as e:
        logging.error(f"An error occurred during AI classification with {provider}: {e}", exc_info=False)
        return None
