/**
 * Reads a `file://` URI handed over by the iOS share-sheet intent and
 * parses it through `parsePkpassBytes`. Split from the parser itself
 * so the parser stays pure and unit-testable without mocking
 * expo-file-system.
 */

import { File } from 'expo-file-system';

import { parsePkpassBytes, type ParsedPass } from './parse-pkpass';

export async function readAndParsePkpassUri(uri: string): Promise<ParsedPass | null> {
  let buffer: ArrayBuffer;
  try {
    const file = new File(uri);
    buffer = await file.arrayBuffer();
  } catch {
    return null;
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return null;
  return parsePkpassBytes(bytes);
}
