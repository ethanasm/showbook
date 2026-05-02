/**
 * Upload route — `/show/[id]/upload`.
 *
 * Picks photos / videos from the device library, uploads them through the
 * `lib/media/upload.ts` pipeline, and streams progress per file. When any
 * file hits over-quota, redirect to `/over-quota` and stop the rest of the
 * batch (consistent with the server's all-or-nothing quota check).
 *
 * Captions can be edited inline on each row before the per-file upload
 * starts. Once a row has progressed past `queued` its caption is locked
 * (the server already received it as part of `createUploadIntent`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { TopBar } from '../../../components/TopBar';
import { EmptyState } from '../../../components/EmptyState';
import { Uploader, type UploaderRow } from '../../../components/Uploader';
import { useTheme } from '../../../lib/theme';
import { RADII } from '../../../lib/theme-utils';
import { trpc } from '../../../lib/trpc';
import { useFeedback } from '../../../lib/feedback';
import {
  pickMediaFromLibrary,
  uploadFile,
  OverQuotaError,
  UploadCancelledError,
  MAX_SELECTION,
  type SelectedFile,
  type UploadServer,
} from '../../../lib/media';

function makeUploadServer(
  client: ReturnType<typeof trpc.useUtils>['client'],
): UploadServer {
  // The mobile tRPC client returns the server's DTOs directly, so we wrap
  // the procedures into the small `UploadServer` interface our pipeline
  // talks to. Errors propagate as-is — `mapServerError` in `upload.ts`
  // handles BAD_REQUEST quota messages and HTTP-status edge cases.
  return {
    createUploadIntent: (input) => client.media.createUploadIntent.mutate(input),
    completeUpload: (input) =>
      client.media.completeUpload.mutate(input).then((dto) => ({
        id: dto.id,
        showId: dto.showId,
        mediaType: dto.mediaType,
        status: dto.status,
        caption: dto.caption,
        bytes: dto.bytes,
        performerIds: dto.performerIds,
        urls: dto.urls,
      })),
  };
}

export default function UploadScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showToast } = useFeedback();
  const params = useLocalSearchParams<{ id: string }>();
  const showId = typeof params.id === 'string' ? params.id : '';

  const utils = trpc.useUtils();
  const [rows, setRows] = useState<UploaderRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-pick on mount so the route opens straight into the system picker.
  // The user can then re-pick via the empty-state CTA if they cancelled.
  useEffect(() => {
    void runPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runPicker = useCallback(async () => {
    setPicking(true);
    try {
      const res = await pickMediaFromLibrary();
      if (res.permissionDenied) {
        showToast({
          kind: 'error',
          text: 'Showbook needs photo library access to upload.',
        });
        return;
      }
      if (res.cancelled) return;
      setRows((prev) => mergeFiles(prev, res.files));
    } finally {
      setPicking(false);
    }
  }, [showToast]);

  const onCaptionChange = useCallback((rowId: string, caption: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, file: { ...r.file, caption } } : r,
      ),
    );
  }, []);

  const onRemove = useCallback((rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  }, []);

  const startUpload = useCallback(async () => {
    if (rows.length === 0 || uploading) return;
    setUploading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const server = makeUploadServer(utils.client);

    let overQuotaHit = false;
    for (const row of rows) {
      if (row.status !== 'queued') continue;
      if (controller.signal.aborted) break;

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, status: 'uploading', progress: 0 } : r,
        ),
      );
      try {
        await uploadFile(row.file, {
          server,
          showId,
          signal: controller.signal,
          onProgress: (fraction) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, progress: fraction } : r,
              ),
            );
          },
        });
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: 'success', progress: 1 } : r,
          ),
        );
      } catch (err) {
        if (err instanceof OverQuotaError) {
          overQuotaHit = true;
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id
                ? { ...r, status: 'failed', errorMessage: err.message }
                : r,
            ),
          );
          break;
        }
        if (err instanceof UploadCancelledError) {
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id ? { ...r, status: 'cancelled' } : r,
            ),
          );
          break;
        }
        const message = err instanceof Error ? err.message : 'Upload failed';
        setRows((prev) =>
          prev.map((r) =>
            r.id === row.id ? { ...r, status: 'failed', errorMessage: message } : r,
          ),
        );
      }
    }

    setUploading(false);
    abortRef.current = null;

    if (overQuotaHit) {
      router.replace('/over-quota');
      return;
    }
    // Refresh the show's media list so ShowDetail picks up new tiles.
    void utils.media.listForShow.invalidate({ showId });
  }, [rows, uploading, utils, showId, router]);

  const onRetry = useCallback(
    (rowId: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, status: 'queued', progress: 0, errorMessage: undefined } : r,
        ),
      );
      // Kick off another pass; queued rows will resume.
      void startUpload();
    },
    [startUpload],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (router.canGoBack()) router.back();
    else router.replace(`/show/${showId}`);
  }, [router, showId]);

  const close = (
    <Pressable
      onPress={cancel}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Close"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  const queuedCount = rows.filter((r) => r.status === 'queued').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Add media" eyebrow="UPLOAD" leading={close} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 96 }}
      >
        {rows.length === 0 ? (
          picking ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.muted} />
            </View>
          ) : (
            <View style={styles.center}>
              <EmptyState
                title="Nothing selected"
                subtitle={`Pick up to ${MAX_SELECTION} photos or videos to add to this show.`}
                cta={{ label: 'Open library', onPress: () => void runPicker() }}
              />
            </View>
          )
        ) : (
          <Uploader
            rows={rows}
            onCaptionChange={onCaptionChange}
            onRemove={onRemove}
            onRetry={onRetry}
            captionsEditable={!uploading}
          />
        )}
      </ScrollView>

      {rows.length > 0 ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: 12 + insets.bottom,
              backgroundColor: colors.surface,
              borderTopColor: colors.rule,
            },
          ]}
        >
          <Pressable
            disabled={uploading || queuedCount === 0}
            onPress={() => void startUpload()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor:
                  queuedCount === 0 ? colors.surfaceRaised : colors.accent,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {uploading ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={[styles.primaryLabel, { color: colors.accentText }]}>
                {queuedCount === 0
                  ? 'Done'
                  : `Upload ${queuedCount}${queuedCount === 1 ? ' file' : ' files'}`}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function mergeFiles(prev: UploaderRow[], files: SelectedFile[]): UploaderRow[] {
  // De-dupe by URI so re-picking the same asset doesn't enqueue twice.
  const existingUris = new Set(prev.map((r) => r.file.uri));
  const next = [...prev];
  for (const file of files) {
    if (existingUris.has(file.uri)) continue;
    if (next.length >= MAX_SELECTION) break;
    next.push({
      id: `${file.uri}#${next.length}`,
      file,
      status: 'queued',
      progress: 0,
    });
  }
  return next;
}

const styles = StyleSheet.create({
  center: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
});
