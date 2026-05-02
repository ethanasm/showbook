/**
 * Uploader — list of upload rows with per-file progress, status, and
 * inline caption inputs. Used by the upload sheet (`app/show/[id]/upload`).
 *
 * The actual upload work happens in `lib/media/upload.ts`. This component
 * is presentational: it accepts an array of `UploadRowState` and renders
 * progress, errors, and caption editors. Caller is responsible for calling
 * the upload pipeline and updating the state.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Check, X, AlertCircle } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';
import type { SelectedFile } from '../lib/media';

export type UploaderRowStatus =
  | 'queued'
  | 'uploading'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface UploaderRow {
  id: string; // stable per-file id (uri + index works)
  file: SelectedFile;
  status: UploaderRowStatus;
  progress: number; // 0..1
  errorMessage?: string;
}

export interface UploaderProps {
  rows: UploaderRow[];
  /** Called when the user edits a row's caption. */
  onCaptionChange: (rowId: string, caption: string) => void;
  /** Called when the user removes a queued row before upload starts. */
  onRemove: (rowId: string) => void;
  /** Called when the user retries a failed row. */
  onRetry?: (rowId: string) => void;
  /** Whether captions are editable (locked once upload starts). */
  captionsEditable: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Uploader({
  rows,
  onCaptionChange,
  onRemove,
  onRetry,
  captionsEditable,
}: UploaderProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View style={styles.list}>
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        return (
          <View
            key={row.id}
            style={[
              styles.row,
              { backgroundColor: colors.surface, borderColor: colors.rule },
              !isLast && styles.rowSpacing,
            ]}
          >
            <View style={styles.thumbWrap}>
              <Image
                source={{ uri: row.file.uri }}
                style={styles.thumb}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
              <ProgressOverlay
                status={row.status}
                progress={row.progress}
                accent={colors.accent}
                bg={colors.surfaceRaised}
              />
            </View>

            <View style={styles.body}>
              <View style={styles.metaRow}>
                <Text style={[styles.metaLabel, { color: colors.faint }]}>
                  {row.file.mediaType === 'video' ? 'VIDEO' : 'PHOTO'}
                </Text>
                <Text style={[styles.metaSize, { color: colors.muted }]}>
                  {formatBytes(row.file.bytes)}
                </Text>
              </View>

              <TextInput
                editable={captionsEditable}
                placeholder="Add a caption…"
                placeholderTextColor={colors.faint}
                value={row.file.caption ?? ''}
                onChangeText={(text) => onCaptionChange(row.id, text)}
                style={[
                  styles.captionInput,
                  { color: colors.ink, borderColor: colors.rule },
                ]}
                maxLength={300}
              />

              <StatusLine row={row} />

              {row.status === 'failed' && onRetry ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry upload"
                  onPress={() => onRetry(row.id)}
                  style={({ pressed }) => [
                    styles.retryBtn,
                    { borderColor: colors.rule },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.retryText, { color: colors.ink }]}>Retry</Text>
                </Pressable>
              ) : null}
            </View>

            {row.status === 'queued' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove from upload"
                onPress={() => onRemove(row.id)}
                hitSlop={10}
                style={styles.closeBtn}
              >
                <X size={16} color={colors.muted} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function StatusLine({ row }: { row: UploaderRow }): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  switch (row.status) {
    case 'uploading':
      return (
        <Text style={[styles.status, { color: colors.muted }]}>
          Uploading… {Math.round(row.progress * 100)}%
        </Text>
      );
    case 'success':
      return (
        <Text style={[styles.status, { color: colors.muted }]}>Uploaded</Text>
      );
    case 'failed':
      return (
        <Text style={[styles.status, { color: colors.danger }]}>
          {row.errorMessage ?? 'Upload failed'}
        </Text>
      );
    case 'cancelled':
      return (
        <Text style={[styles.status, { color: colors.faint }]}>Cancelled</Text>
      );
    default:
      return null;
  }
}

function ProgressOverlay({
  status,
  progress,
  accent,
  bg,
}: {
  status: UploaderRowStatus;
  progress: number;
  accent: string;
  bg: string;
}): React.JSX.Element | null {
  if (status === 'queued') return null;
  if (status === 'success') {
    return (
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
        <Check size={20} color="#fff" strokeWidth={2.5} />
      </View>
    );
  }
  if (status === 'failed') {
    return (
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
        <AlertCircle size={20} color="#fff" strokeWidth={2.5} />
      </View>
    );
  }
  if (status === 'uploading') {
    const pct = Math.max(0, Math.min(1, progress));
    return (
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <ActivityIndicator color="#fff" />
        <View style={[styles.progressTrack, { backgroundColor: bg }]}>
          <View
            style={[styles.progressFill, { backgroundColor: accent, width: `${pct * 100}%` }]}
          />
        </View>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: 'row',
    padding: 10,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
  },
  rowSpacing: {
    marginBottom: 10,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: RADII.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  progressTrack: {
    height: 3,
    width: 48,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  body: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 9.5,
    fontWeight: '500',
    letterSpacing: 1,
  },
  metaSize: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
  },
  captionInput: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.sm,
  },
  status: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
  },
  retryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
  },
  retryText: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    alignSelf: 'flex-start',
    padding: 4,
  },
});
