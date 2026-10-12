// Text extraction for uploaded resumes (PDF, DOCX, TXT).
import fs from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

export const RESUME_EXTS = ['.pdf', '.docx', '.txt'];

export async function extractResumeText(filePath, ext) {
  const buf = await fs.readFile(filePath);
  if (ext === '.pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return String(text || '').replace(/[ \t]+\n/g, '\n').trim();
  }
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value.trim();
  }
  if (ext === '.txt') return buf.toString('utf8').trim();
  throw new Error(`Unsupported resume format ${ext}`);
}
