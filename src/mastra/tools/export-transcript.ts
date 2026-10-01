import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { DescriptClient } from '../lib/descript-client';
import { env } from '../../lib/env';

export const exportTranscriptInput = z.object({
  project_id: z.string().uuid(),
  composition_id: z
    .string()
    .optional()
    .describe('Composition UUID, 5-char short ID, or full project URL. Defaults to the first composition in the project.'),
  format: z
    .enum(['txt', 'markdown', 'html', 'rtf', 'docx', 'srt'])
    .default('markdown')
    .describe('Output format. "srt" yields timed SubRip captions; "docx" is binary and returned base64-encoded.'),
  include_speaker_labels: z.enum(['off', 'changes', 'every_paragraph']).default('changes'),
  include_markers: z.boolean().default(false),
  timecodes: z
    .object({
      frequency_seconds: z.number().positive().optional().describe('Insert a timecode every N seconds'),
      on_paragraphs: z.boolean().optional(),
      on_speakers: z.boolean().optional(),
      on_markers: z.boolean().optional(),
      offset_seconds: z.number().optional().describe('Offset applied to all timecodes'),
    })
    .optional()
    .describe('When provided, timecodes are included in the output'),
});

export const exportTranscriptOutput = z.object({
  content: z.string().describe('Transcript file contents (base64 when encoding is "base64")'),
  encoding: z.enum(['utf8', 'base64']),
  format: z.string(),
  composition_id: z.string().optional(),
  filename: z.string().optional(),
});

export async function runExportTranscript(context: z.infer<typeof exportTranscriptInput>): Promise<z.infer<typeof exportTranscriptOutput>> {
  const client = new DescriptClient(env.DESCRIPT_API_TOKEN);
  const r = await client.exportTranscript(context);
  return { ...r, format: context.format };
}

export const exportTranscript = createTool({
  id: 'exportTranscript',
  description:
    'Export the transcript of a project composition as txt, markdown, html, rtf, docx, or srt (timed captions), with optional speaker labels, markers, and timecodes. Works on ANY project — no publish needed (unlike getPublishedSubtitles). Use for show notes, blog drafts, summaries, quotes, or SRT caption files. COST: free — read-only, no AI credits or media minutes.',
  inputSchema: exportTranscriptInput,
  outputSchema: exportTranscriptOutput,
  execute: (context) => runExportTranscript(context),
});
