# Underlord prompt patterns

Every prompt should: name the action, name the scope (whole composition, a scene, a time range), and say "apply directly".

| Goal | Prompt |
| --- | --- |
| Filler cleanup | Remove filler words (um, uh, you know, like) and repeated words across the whole composition. Apply the edits directly. |
| Tighten pacing | Shorten every pause longer than 1 second to 0.5 seconds. Apply directly. |
| Studio sound | Apply Studio Sound to all voice tracks at 80% intensity. Apply directly. |
| Captions | Add animated captions in the project's default caption style to the whole composition. Apply directly. |
| Chapters | Add a marker at each major topic change, named after the topic. Apply directly. |
| Remove section | Delete everything between "<first words>" and "<last words>". Apply directly. |
| Script from scratch | (no project_id, with project_name) Write a 60-second script about <topic> with a hook, three points and a call to action. |

Anti-patterns that stall or waste credits:
- "Make it better" / "edit this" (no concrete action -> plan approval stall)
- Asking several unrelated things in one prompt on a strong model
- Re-running a stalled prompt unchanged
