# OpenAI Compatibility | Gemini API | Google AI for Developers

Gemini models are accessible using the OpenAI libraries (Python and TypeScript / Javascript) along with the REST API, by updating three lines of code and using your [Gemini API key](https://aistudio.google.com/apikey). If you aren't already using the OpenAI libraries, we recommend that you call the [Gemini API directly](https://ai.google.dev/gemini-api/docs/quickstart).

## Quick Start Examples

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [
      {"role": "user", "content": "Explain to me how AI works"}
    ]
  }'
```

## What Changed? Just Three Lines

1. **`api_key="GEMINI_API_KEY"`**: Replace "GEMINI_API_KEY" with your actual Gemini API key, which you can get in [Google AI Studio](https://aistudio.google.com).
2. **`base_url="https://generativelanguage.googleapis.com/v1beta/openai/"`**: This tells the OpenAI library to send requests to the Gemini API endpoint instead of the default URL.
3. **`model="gemini-2.0-flash"`**: Choose a compatible Gemini model

## Thinking

Gemini 2.5 models are trained to think through complex problems, leading to significantly improved reasoning. The Gemini API comes with a ["thinking budget" parameter](/gemini-api/docs/thinking#set-budget) which gives fine grain control over how much the model will think.

Unlike the Gemini API, the OpenAI API offers three levels of thinking control: `"low"`, `"medium"`, and `"high"`, which map to 1,024, 8,192, and 24,576 tokens, respectively.

If you want to disable thinking, you can set `reasoning_effort` to `"none"` (note that reasoning cannot be turned off for 2.5 Pro models).

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.5-flash",
    "reasoning_effort": "low",
    "messages": [
      {"role": "user", "content": "Explain to me how AI works"}
    ]
  }'
```

Gemini thinking models also produce [thought summaries](/gemini-api/docs/thinking#summaries) and can use exact [thinking budgets](/gemini-api/docs/thinking#set-budget). You can use the [extra_body](#extra-body) field to include these fields in your request.

Note that `reasoning_effort` and `thinking_budget` overlap functionality, so they can't be used at the same time.

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Explain to me how AI works"}],
    "extra_body": {
      "google": {
        "thinking_config": {
          "include_thoughts": true
        }
      }
    }
  }'
```

## Streaming

The Gemini API supports [streaming responses](/gemini-api/docs/text-generation?lang=python#generate-a-text-stream).

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [
      {"role": "user", "content": "Explain to me how AI works"}
    ],
    "stream": true
  }'
```

## Function Calling

Function calling makes it easier for you to get structured data outputs from generative models and is [supported in the Gemini API](/gemini-api/docs/function-calling/tutorial).

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "gemini-2.0-flash",
    "messages": [
      {
        "role": "user",
        "content": "What'\''s the weather like in Chicago today?"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather in a given location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "The city and state, e.g. Chicago, IL"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"]
              }
            },
            "required": ["location"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

## Image Understanding

Gemini models are natively multimodal and provide best in class performance on [many common vision tasks](/gemini-api/docs/vision).

### REST

```bash
bash -c '
base64_image=$(base64 -i "Path/to/agi/image.jpeg");
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d "{
    \"model\": \"gemini-2.0-flash\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": [
          { \"type\": \"text\", \"text\": \"What is in this image?\" },
          {
            \"type\": \"image_url\",
            \"image_url\": { \"url\": \"data:image/jpeg;base64,${base64_image}\" }
          }
        ]
      }
    ]
  }"
'
```

## Generate an Image

Generate an image:

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/images/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "model": "imagen-3.0-generate-002",
    "prompt": "a portrait of a sheepadoodle wearing a cape",
    "response_format": "b64_json",
    "n": 1,
  }'
```

## Audio Understanding

Analyze audio input:

### REST

```bash
bash -c '
base64_audio=$(base64 -i "/path/to/your/audio/file.wav");
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d "{
    \"model\": \"gemini-2.0-flash\",
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": [
          { \"type\": \"text\", \"text\": \"Transcribe this audio file.\" },
          {
            \"type\": \"input_audio\",
            \"input_audio\": {
              \"data\": \"${base64_audio}\",
              \"format\": \"wav\"
            }
          }
        ]
      }
    ]
  }"
'
```

## Structured Output

Gemini models can output JSON objects in any [structure you define](/gemini-api/docs/structured-output).

(Note: Structured output examples are typically shown with Python/JavaScript SDKs. For REST API usage, refer to the Gemini API documentation for structured output.)

## Embeddings

Text embeddings measure the relatedness of text strings and can be generated using the [Gemini API](/gemini-api/docs/embeddings).

### REST

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/embeddings" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GEMINI_API_KEY" \
  -d '{
    "input": "Your text string goes here",
    "model": "gemini-embedding-001"
  }'
```

## extra_body

There are several features supported by Gemini that are not available in OpenAI models but can be enabled using the `extra_body` field.

### extra_body Features

| Feature           | Description                                                    |
| ----------------- | -------------------------------------------------------------- |
| `safety_settings` | Corresponds to Gemini's SafetySetting.                         |
| `cached_content`  | Corresponds to Gemini's GenerateContentRequest.cached_content. |
| `thinking_config` | Corresponds to Gemini's ThinkingConfig.                        |

### cached_content

Here's an example of using `extra_body` to set `cached_content`:

(Note: This feature is typically used with Python/JavaScript SDKs. For REST API usage, include the cached_content in the request body under the google.cached_content field.)

## List Models

Get a list of available Gemini models:

### REST

```bash
curl https://generativelanguage.googleapis.com/v1beta/openai/models \
  -H "Authorization: Bearer GEMINI_API_KEY"
```

## Retrieve a Model

Retrieve a Gemini model:

### REST

```bash
curl https://generativelanguage.googleapis.com/v1beta/openai/models/gemini-2.0-flash \
  -H "Authorization: Bearer GEMINI_API_KEY"
```

## Current Limitations

Support for the OpenAI libraries is still in beta while we extend feature support. If you have questions about supported parameters, upcoming features, or run into any issues getting started with Gemini, join our [Developer Forum](https://discuss.ai.google.dev/c/gemini-api/4).

## What's Next

Try our [OpenAI Compatibility Colab](https://colab.sandbox.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_OpenAI_Compatibility.ipynb) to work through more detailed examples.
