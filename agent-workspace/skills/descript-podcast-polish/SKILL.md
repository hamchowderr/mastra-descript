---
name: descript-podcast-polish
description: Use when the user wants to clean up, polish or produce a podcast/interview/talking-head episode in Descript - import raw audio/video, clean filler words, Studio Sound, chapters, publish, and produce show notes.
---

# Podcast / interview polish

## Pipeline

1. **Import** - `importMedia` with every file (host, guest, intro music) in one call so they land in one project. Use public URLs or local files in the agent workspace (`file_path`); importMedia checks URLs and files itself before submitting. If host and guest were recorded as separate files of the same conversation, group them with `multitrack` so they play together as synced tracks (set `offset` in seconds if one started later); intro/outro music stays a normal clip. Imports spend media-seconds only.
2. **Clean** - ONE `agentEdit` with an explicit combined prompt (load `descript-cost-safe-editing` first if unsure):
   "Remove filler words and repeated words, shorten pauses longer than 1 second to 0.5 seconds, and apply Studio Sound to all voice tracks. Apply the edits directly."
3. **Chapters (optional)** - follow up with the same `conversation_id`:
   "Add a marker at each major topic change, named after the topic. Apply directly."
4. **Show notes** - `exportTranscript` with `format: "markdown"`, `include_speaker_labels: "changes"`, `include_markers: true`, `timecodes: { on_markers: true }`. Summarize into: title, 2-sentence summary, chapter list with timecodes, 3 pull quotes. This is free.
5. **Publish** - `publish` without `media_type`: Descript publishes audio-only shows as Audio and video as Video. Return `share_url` and `download_url` (note the download link expires).

For an unattended version of steps 1, 2 and 5 use the `importEditPublish` workflow; it pauses for approval before step 2.

## Report back

- project_url, ai_credits_used per edit, total from `getCostTotals`
- share_url / download_url
- show notes (inline, or a note that they can be regenerated any time with exportTranscript)
