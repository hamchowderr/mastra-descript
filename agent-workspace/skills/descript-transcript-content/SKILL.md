---
name: descript-transcript-content
description: Use when the user wants text content derived from a recording - transcripts, show notes, blog posts, summaries, quotes, newsletters, docx/rtf documents, or searching what was said across projects.
---

# Transcript-derived content

Everything here is FREE (no AI credits): it uses `searchDrive` and `exportTranscript`, then you write the content yourself.

## Steps

1. Locate the project: use the project_id if given; otherwise `searchDrive` (`match: ["content"]` for "the episode where...", `type: ["project"]`) or `listProjects`.
2. Export with the right options:

| Deliverable | format | options |
| --- | --- | --- |
| Summary / blog / newsletter | markdown | include_speaker_labels: "changes" |
| Quotes with timestamps | txt | timecodes: { on_paragraphs: true } |
| Chaptered show notes | markdown | include_markers: true, timecodes: { on_markers: true } |
| Caption file | srt | - |
| Client document | docx or rtf | docx is returned base64 (encoding: "base64") - offer to save it in the workspace rather than pasting it |

3. Write the content from the exported text. Quote verbatim; never invent quotes or timestamps.
4. For long exports, summarize section by section rather than dumping the full transcript to the user.

Use the `transcriptExport` workflow for repeatable, non-interactive export runs.
