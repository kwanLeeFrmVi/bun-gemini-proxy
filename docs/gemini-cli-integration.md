
# Gemini CLI Integration

## Overview

This document provides a detailed guide to the `/gemini-cli` route, a powerful feature of the proxy server that allows you to interact with the `gemini` command-line tool through an OpenAI-compatible API. This integration enables you to use any OpenAI-compatible client, such as code editors or command-line tools, to send requests to the `gemini` CLI and receive responses in a standardized format.

## Purpose

The primary goal of the `/gemini-cli` route is to bridge the gap between the `gemini` CLI and the broader ecosystem of tools that support the OpenAI API. By exposing the `gemini` CLI's functionality through a familiar API, this feature allows you to:

*   Integrate the `gemini` CLI into your existing workflows and applications without modification.
*   Leverage the power of the Gemini model through a simple and consistent interface.
*   Utilize OpenAI-compatible clients to interact with the `gemini` CLI, enhancing your development experience.

## API Endpoints

The `/gemini-cli` route exposes the following endpoints:

### `POST /gemini-cli/v1/chat/completions`

This is the main endpoint for processing chat requests. It accepts an OpenAI-compatible chat completion request and uses the `gemini` CLI to generate a response.

**Request Body:**

```json
{
  "model": "gemini-2.5-pro",
  "messages": [
    {
      "role": "user",
      "content": "Explain the importance of a well-structured README file."
    }
  ]
}
```

**Response Body:**

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gemini-2.5-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "A well-structured README file is crucial for any software project..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 150,
    "total_tokens": 170
  }
}
```

### `GET /gemini-cli/v1/models`

This endpoint lists the models supported by the `gemini` CLI backend.

**Example Request:**

```bash
curl http://localhost:8000/gemini-cli/v1/models
```

**Example Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "gemini-2.5-pro",
      "object": "model",
      "created": 1677606400,
      "owned_by": "google"
    },
    {
      "id": "gemini-2.5-flash",
      "object": "model",
      "created": 1677606400,
      "owned_by": "google"
    }
  ]
}
```

### `GET /gemini-cli/v1/health`

This endpoint performs a health check to verify the availability of the `gemini` CLI and retrieves its version.

**Example Request:**

```bash
curl http://localhost:8000/gemini-cli/v1/health
```

**Example Response (Healthy):**

```json
{
  "status": "healthy",
  "cli_available": true,
  "cli_version": "gemini 1.0.0"
}
```

**Example Response (Unhealthy):**

```json
{
  "status": "unhealthy",
  "error": "gemini CLI not found"
}
```

## Model Support

The `/gemini-cli` route supports the following models:

*   `gemini-2.5-pro`
*   `gemini-2.5-flash`
*   `gemini-2.0-flash-exp`
*   `gemini-exp-1206`

## Limitations

*   **Streaming Not Supported:** The `gemini` CLI backend does not support streaming responses. Therefore, requests with `stream=true` will be rejected.
*   **Image Input Not Supported:** The current integration does not support image inputs.

## Client Configuration

To use the `/gemini-cli` route with an OpenAI-compatible client, you need to configure the client to use the proxy server's address as the API endpoint. For example, if the proxy is running on `http://localhost:8000`, you would set the client's base URL to `http://localhost:8000/gemini-cli`.
