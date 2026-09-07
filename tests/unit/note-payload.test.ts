import { describe, it, expect } from 'vitest';
import { notePayloadSchema, saveItemInputSchema } from '@passshield/validation';

/**
 * Secure-note payload validation.
 *
 * Notes are composed like an email message: an optional subject, a markdown
 * body, and optional Base64-encoded attachments. These tests lock in backward
 * compatibility (legacy notes carry only `content`) alongside the newer
 * subject + attachments fields, at the IPC boundary schema level.
 */
describe('note payload validation', () => {
  const baseSave = {
    itemType: 'note' as const,
    title: 'My note',
    categoryId: null,
    isFavorite: false,
  };

  it('accepts a legacy note payload with only content', () => {
    const result = notePayloadSchema.safeParse({ content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a note with a subject and attachments', () => {
    const result = notePayloadSchema.safeParse({
      content: 'body',
      subject: 'Recovery codes',
      attachments: [
        { filename: 'codes.txt', mimeType: 'text/plain', size: 12, data: 'aGVsbG8gd29ybGQ=' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an attachment with a negative size', () => {
    const result = notePayloadSchema.safeParse({
      content: 'body',
      attachments: [{ filename: 'x', mimeType: 'text/plain', size: -1, data: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a full save input for a legacy content-only note', () => {
    const result = saveItemInputSchema.safeParse({
      ...baseSave,
      payload: { content: 'only content' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full save input with subject + attachments', () => {
    const result = saveItemInputSchema.safeParse({
      ...baseSave,
      payload: {
        content: 'body',
        subject: 'Subject line',
        attachments: [
          { filename: 'a.pdf', mimeType: 'application/pdf', size: 2048, data: 'JVBERi0=' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});
