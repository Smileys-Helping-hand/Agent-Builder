# Voice Interface Guide

Agent Builder Ultra now supports optional speech input and output for AutoCode conversations. The feature is powered by the `VoiceController` class, which integrates Whisper-based speech-to-text and edge-tts synthesis.

## Prerequisites

1. Install the voice dependencies:
   ```bash
   npm install whisper-tts edge-tts
   npm --prefix dashboard install react-speech-recognition
   ```
2. Set the required environment variables in `.env`:
   ```env
   VOICE_ENABLED=true
   AI_PROVIDER=ollama # or openai / lmstudio
   ```

3. Provide audio input devices to the dashboard browser session. The microphone toggle in the AutoCode tab will only activate if the browser supports Web Speech APIs.

## Runtime Behavior

- **startListening**: enables Whisper transcription and streams recognized phrases back to the chat window.
- **stopListening**: halts transcription and clears any pending microphone captures.
- **speak**: converts AutoCode responses into cached MP3 files stored under `data/voice/`.

## Troubleshooting

- If Whisper or edge-tts packages are missing, the controller gracefully falls back to simulated responses and logs a warning.
- Ensure `VOICE_ENABLED` is set to `true`; otherwise the microphone button will remain disabled in the UI.
- Vector memory must be configured to persist transcript history. Provide `PGVECTOR_URL` before enabling large-scale voice sessions.
