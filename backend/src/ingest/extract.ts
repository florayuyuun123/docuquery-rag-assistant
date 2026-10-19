/**
 * Text extraction utilities for the DocuQuery ingestion pipeline.
 *
 * Supports PDF (text layer + Textract OCR fallback), DOCX (via mammoth),
 * and TXT (UTF-8 decode).
 *
 * Satisfies Requirements 4.1, 4.2, 4.3, 4.4, 4.9, 14.1, 14.2, 14.3, 14.4.
 */

import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import mammoth from 'mammoth';

const textract = new TextractClient({});

/**
 * Poll Textract for a completed text detection job.
 * Polls every 5 seconds until the job status is SUCCEEDED or FAILED.
 */
async function pollTextractJob(jobId: string): Promise<string> {
  const maxAttempts = 60; // up to 5 minutes
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await textract.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId }),
    );

    const status = response.JobStatus;
    if (status === 'SUCCEEDED') {
      const lines: string[] = [];
      let nextToken: string | undefined;

      do {
        const pageResult = await textract.send(
          new GetDocumentTextDetectionCommand({
            JobId: jobId,
            NextToken: nextToken,
          }),
        );

        for (const block of pageResult.Blocks ?? []) {
          if (block.BlockType === 'LINE' && block.Text) {
            lines.push(block.Text);
          }
        }
        nextToken = pageResult.NextToken;
      } while (nextToken);

      return lines.join('\n');
    }

    if (status === 'FAILED') {
      throw new Error(`Textract job ${jobId} failed: ${response.StatusMessage ?? 'unknown error'}`);
    }

    // SUBMITTED or IN_PROGRESS — wait 5 seconds before next poll
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Textract job ${jobId} timed out after ${maxAttempts} polling attempts`);
}

/**
 * Extract plain text from a document.
 *
 * @param s3Key       - S3 object key (used for Textract S3 reference)
 * @param fileBytes   - Raw file content as a Buffer
 * @param contentType - MIME type of the file
 * @param bucketName  - S3 bucket name (used for Textract S3 reference)
 * @returns Extracted plain text string
 */
export async function extractText(
  s3Key: string,
  fileBytes: Buffer,
  contentType: string,
  bucketName: string,
): Promise<string> {
  // TXT: decode as UTF-8
  if (contentType === 'text/plain') {
    return fileBytes.toString('utf-8');
  }

  // DOCX: use mammoth to extract raw text, preserving paragraph boundaries
  if (
    contentType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer: fileBytes });
    return result.value;
  }

  // PDF: try text layer extraction first via pdf-parse, fallback to Textract OCR
  if (contentType === 'application/pdf') {
    try {
      // Use require() to avoid ESM/CJS interop issues with pdf-parse
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
      const data = await pdfParse(fileBytes);
      const extracted = data.text.trim();
      if (extracted.length > 0) {
        return data.text;
      }
      // Empty text layer — fall through to Textract
    } catch {
      // pdf-parse failed — fall through to Textract
    }

    // Textract OCR fallback for scanned PDFs
    const startResponse = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: bucketName,
            Name: s3Key,
          },
        },
      }),
    );

    const jobId = startResponse.JobId;
    if (!jobId) {
      throw new Error('Textract did not return a JobId');
    }

    return await pollTextractJob(jobId);
  }

  throw new Error(`Unsupported content type: ${contentType}`);
}
