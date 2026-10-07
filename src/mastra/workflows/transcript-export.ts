import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { exportTranscriptInput, exportTranscriptOutput, runExportTranscript } from '../tools/export-transcript';

const exportStep = createStep({
  id: 'export',
  inputSchema: exportTranscriptInput,
  outputSchema: exportTranscriptOutput,
  execute: async ({ inputData }) => runExportTranscript(inputData),
});

const statsStep = createStep({
  id: 'stats',
  inputSchema: exportTranscriptOutput,
  outputSchema: exportTranscriptOutput.extend({
    word_count: z.number().optional(),
    speakers: z.array(z.string()).optional(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.encoding !== 'utf8') return inputData;
    const text = inputData.content;
    const speakers = [...new Set([...text.matchAll(/^\**([A-Z][\w .'-]{0,40}?)\**:/gm)].map((m) => m[1].trim()))];
    return { ...inputData, word_count: text.split(/\s+/).filter(Boolean).length, speakers: speakers.length ? speakers : undefined };
  },
});

export const transcriptExportWorkflow = createWorkflow({
  id: 'transcriptExport',
  description:
    'Export a project transcript (txt/markdown/html/rtf/docx/srt) and attach word count + detected speakers. Free — no AI credits or media minutes.',
  inputSchema: exportTranscriptInput,
  outputSchema: exportTranscriptOutput.extend({
    word_count: z.number().optional(),
    speakers: z.array(z.string()).optional(),
  }),
})
  .then(exportStep)
  .then(statsStep)
  .commit();
