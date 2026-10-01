---
name: descript-social-clips
description: Use when the user wants short-form social clips, reels, shorts, TikToks, captions or SRT/VTT subtitle files from an existing Descript project or recording.
---

# Social clips and captions

## Find the material

- If the user describes the content ("the bit where we talk about pricing"), use `searchDrive` with `match: ["content"]` to find the project, then `exportTranscript` (`format: "txt"`, `timecodes: { frequency_seconds: 30 }`) to locate the moment. Both are free.
- Pick 1-3 candidate moments (15-60 s each, strong hook in the first 3 seconds) and confirm them with the user before editing when they did not already specify.

## Make the clip (spends AI credits)

`agentEdit` on the project, one explicit prompt per clip, chaining `conversation_id`:

"Create a new composition named '<clip name>' containing only the section from '<first words>' to '<last words>'. Make it 9:16 vertical, add animated captions, and remove filler words. Apply directly."

Then `publish` the new composition (pass its `composition_id` if the edit result returned one; otherwise `getProject` to find it).

## Captions only (free)

- Unpublished project: `exportTranscript` with `format: "srt"`.
- Already published: `getPublishedSubtitles` with the share-URL slug (WEBVTT).

Never claim a clip exists until agentEdit returned `project_changed: true`.
