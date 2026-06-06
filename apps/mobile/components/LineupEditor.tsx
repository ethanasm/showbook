/**
 * LineupEditor — multi-row performer / lineup picker used by the
 * add/edit show form for every kind.
 *
 * Per-row layout:
 *   [drag handle] [artist typeahead]  [tier pill: festival]  [trash]
 *                                     [character name: theatre]
 *
 * The component is kind-aware purely to render the right trailing
 * controls — the underlying `PerformerRow` carries both
 * `characterName` and `tier` at all times so switching kinds preserves
 * the user's data (only the active kind's projection is sent on save;
 * see `lib/showForm.ts`).
 *
 * Drag reordering is powered by `react-native-draggable-flatlist`'s
 * `NestableDraggableFlatList`, so the caller's outer scroll container
 * must be a `NestableScrollContainer` for drag to work. On `web` the
 * draggable lib's gesture pipeline isn't reliable, so we fall back to
 * a static `View` map; reorder still works on iOS / Android (the
 * shipped platforms).
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { GripVertical, Plus, X, Star } from 'lucide-react-native';
import NestableDraggableFlatListImport, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useDebouncedValue } from '@showbook/shared/hooks';
import { hapticSelection } from '@/lib/haptics';
import { ArtistTypeahead, type ArtistSuggestion } from './ArtistTypeahead';
import { FormField } from './FormField';
import type { PerformerRow, ShowFormKind } from '@/lib/showForm';

// react-native-draggable-flatlist's CJS interop sometimes resolves the
// default export under `.default`; both Metro and TS-node paths land
// here, so prefer the typed-named export when present.
const NestableDraggableFlatList =
  (NestableDraggableFlatListImport as unknown as {
    NestableDraggableFlatList?: typeof NestableDraggableFlatListImport;
  }).NestableDraggableFlatList ?? NestableDraggableFlatListImport;

export interface LineupEditorProps {
  rows: PerformerRow[];
  onChange: (next: PerformerRow[]) => void;
  kind: ShowFormKind;
  testID?: string;
}

let _idCounter = 0;
export function newPerformerRowId(): string {
  _idCounter += 1;
  return `lr-${Date.now().toString(36)}-${_idCounter}`;
}

function defaultTierForKind(kind: ShowFormKind): 'support' {
  // New rows always start as 'support'. Festival users can tap to
  // promote to headliner — non-festival kinds don't surface tier.
  void kind;
  return 'support';
}

export function LineupEditor({
  rows,
  onChange,
  kind,
  testID,
}: LineupEditorProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  // Track which row is being edited via typeahead so we only fetch
  // suggestions for the focused row. Suggestions are fetched lazily.
  const [activeRowId, setActiveRowId] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(searchQuery, 250);

  const localSearchQuery = trpc.performers.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.trim().length > 0, staleTime: 60_000 },
  );
  // For theatre the kind routes searchExternal to Wikidata (cast members
  // have no Ticketmaster page); every other kind keeps the TM search.
  const externalSearchQuery = trpc.performers.searchExternal.useQuery(
    { query: debouncedQuery, kind },
    { enabled: debouncedQuery.trim().length > 0, staleTime: 60_000 },
  );

  const suggestions = React.useMemo<ArtistSuggestion[]>(() => {
    if (debouncedQuery.trim().length === 0) return [];
    const out: ArtistSuggestion[] = [];
    const seen = new Set<string>();
    const dedupKey = (name: string, tmId?: string | null) =>
      `${(tmId ?? '').toLowerCase()}|${name.toLowerCase()}`;

    for (const local of localSearchQuery.data ?? []) {
      const key = dedupKey(local.name, local.ticketmasterAttractionId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `local:${local.id}`,
        name: local.name,
        imageUrl: local.imageUrl ?? null,
        tmAttractionId: local.ticketmasterAttractionId ?? null,
        musicbrainzId: local.musicbrainzId ?? null,
        source: 'Followed / library',
      });
    }
    for (const ext of externalSearchQuery.data ?? []) {
      const extId = ext.wikidataQid ?? ext.tmAttractionId;
      const key = dedupKey(ext.name, extId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: ext.wikidataQid ? `wd:${ext.wikidataQid}` : `tm:${ext.tmAttractionId}`,
        name: ext.name,
        imageUrl: ext.imageUrl ?? null,
        tmAttractionId: ext.tmAttractionId,
        wikidataQid: ext.wikidataQid ?? null,
        musicbrainzId: ext.musicbrainzId,
        subtitle: ext.subtitle ?? null,
        source: ext.wikidataQid ? 'Wikidata' : 'Ticketmaster',
      });
    }
    return out.slice(0, 8);
  }, [debouncedQuery, localSearchQuery.data, externalSearchQuery.data]);

  const loading = localSearchQuery.isFetching || externalSearchQuery.isFetching;

  const updateRow = React.useCallback(
    (id: string, patch: Partial<PerformerRow>) => {
      onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [rows, onChange],
  );

  const removeRow = React.useCallback(
    (id: string) => {
      void hapticSelection();
      onChange(rows.filter((r) => r.id !== id));
      if (activeRowId === id) {
        setActiveRowId(null);
        setSearchQuery('');
      }
    },
    [rows, onChange, activeRowId],
  );

  const addRow = React.useCallback(() => {
    void hapticSelection();
    const next: PerformerRow = {
      id: newPerformerRowId(),
      name: '',
      tier: defaultTierForKind(kind),
    };
    onChange([...rows, next]);
    setActiveRowId(next.id);
    setSearchQuery('');
  }, [rows, onChange, kind]);

  const selectArtist = React.useCallback(
    (rowId: string, artist: ArtistSuggestion) => {
      updateRow(rowId, {
        name: artist.name,
        tmAttractionId: artist.tmAttractionId ?? undefined,
        wikidataQid: artist.wikidataQid ?? undefined,
        musicbrainzId: artist.musicbrainzId ?? undefined,
        imageUrl: artist.imageUrl ?? undefined,
      });
      setActiveRowId(null);
      setSearchQuery('');
    },
    [updateRow],
  );

  const toggleTier = React.useCallback(
    (id: string) => {
      void hapticSelection();
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      updateRow(id, {
        tier: row.tier === 'headliner' ? 'support' : 'headliner',
      });
    },
    [rows, updateRow],
  );

  const renderRow = React.useCallback(
    (
      row: PerformerRow,
      params: { drag?: () => void; isActive?: boolean } = {},
    ): React.JSX.Element => {
      const isEditing = activeRowId === row.id;
      const drag = params.drag;
      const isActive = !!params.isActive;
      const showSelected = !isEditing && row.name.trim().length > 0;
      return (
        <View
          style={[
            styles.rowWrap,
            { borderColor: colors.rule, backgroundColor: colors.surface },
            isActive && { opacity: 0.85, backgroundColor: colors.surfaceRaised },
          ]}
          testID={testID ? `${testID}-row-${row.id}` : undefined}
        >
          <View style={styles.rowMain}>
            {drag ? (
              <Pressable
                onLongPress={drag}
                delayLongPress={120}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Drag to reorder"
                style={({ pressed }) => [styles.dragHandle, pressed && { opacity: 0.6 }]}
              >
                <GripVertical size={16} color={colors.faint} strokeWidth={2} />
              </Pressable>
            ) : (
              <View style={styles.dragHandle}>
                <GripVertical size={16} color={colors.faint} strokeWidth={2} />
              </View>
            )}

            <View style={styles.rowInputWrap}>
              {showSelected ? (
                <Pressable
                  onPress={() => {
                    setActiveRowId(row.id);
                    setSearchQuery(row.name);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Change ${row.name}`}
                  style={({ pressed }) => [
                    styles.selectedChip,
                    { borderColor: colors.rule, backgroundColor: colors.surface },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {row.imageUrl ? (
                    <Image
                      source={{ uri: row.imageUrl }}
                      style={[styles.chipThumb, { borderColor: colors.rule }]}
                    />
                  ) : null}
                  <Text style={[styles.chipName, { color: colors.ink }]} numberOfLines={1}>
                    {row.name}
                  </Text>
                  {row.tmAttractionId ? (
                    <Text style={[styles.chipMeta, { color: colors.muted }]}>
                      TM
                    </Text>
                  ) : null}
                </Pressable>
              ) : (
                <ArtistTypeahead
                  value={isEditing ? searchQuery : row.name}
                  onChange={(text) => {
                    setActiveRowId(row.id);
                    setSearchQuery(text);
                    updateRow(row.id, {
                      name: text,
                      // editing a manual name disowns any previously
                      // matched IDs — they don't apply to a new string
                      tmAttractionId: undefined,
                      wikidataQid: undefined,
                      musicbrainzId: undefined,
                      imageUrl: undefined,
                    });
                  }}
                  onSelect={(artist) => selectArtist(row.id, artist)}
                  onSearch={() => undefined}
                  suggestions={isEditing ? suggestions : []}
                  loading={isEditing && loading}
                  placeholder={
                    kind === 'theatre'
                      ? 'Cast member name'
                      : kind === 'festival'
                        ? 'Artist on the lineup'
                        : 'Artist or comedian'
                  }
                  autoFocus={isEditing && row.name.trim().length === 0}
                  testID={testID ? `${testID}-input-${row.id}` : undefined}
                />
              )}
            </View>

            {kind === 'festival' ? (
              <Pressable
                onPress={() => toggleTier(row.id)}
                accessibilityRole="button"
                accessibilityLabel={
                  row.tier === 'headliner' ? 'Mark as support' : 'Mark as headliner'
                }
                style={({ pressed }) => [
                  styles.tierPill,
                  {
                    borderColor: row.tier === 'headliner' ? colors.accent : colors.rule,
                    backgroundColor:
                      row.tier === 'headliner' ? colors.accent : 'transparent',
                  },
                  pressed && { opacity: 0.7 },
                ]}
                testID={testID ? `${testID}-tier-${row.id}` : undefined}
              >
                {row.tier === 'headliner' ? (
                  <Star size={11} color={colors.accentText} strokeWidth={2.4} fill={colors.accentText} />
                ) : null}
                <Text
                  style={[
                    styles.tierPillText,
                    {
                      color:
                        row.tier === 'headliner' ? colors.accentText : colors.muted,
                    },
                  ]}
                >
                  {row.tier === 'headliner' ? 'HEADLINER' : 'SUPPORT'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => removeRow(row.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove"
              style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
              testID={testID ? `${testID}-remove-${row.id}` : undefined}
            >
              <X size={14} color={colors.muted} strokeWidth={2} />
            </Pressable>
          </View>

          {kind === 'theatre' ? (
            <View style={styles.characterRow}>
              <Text style={[styles.characterLabel, { color: colors.faint }]}>
                AS
              </Text>
              <TextInput
                value={row.characterName ?? ''}
                onChangeText={(v) => updateRow(row.id, { characterName: v })}
                placeholder="Character / role (optional)"
                placeholderTextColor={colors.faint}
                style={[
                  styles.characterInput,
                  {
                    color: colors.ink,
                    borderColor: colors.rule,
                    backgroundColor: colors.bg,
                  },
                ]}
                testID={testID ? `${testID}-character-${row.id}` : undefined}
              />
            </View>
          ) : null}
        </View>
      );
    },
    [
      activeRowId,
      colors,
      kind,
      loading,
      removeRow,
      searchQuery,
      selectArtist,
      suggestions,
      testID,
      toggleTier,
      updateRow,
    ],
  );

  const labelByKind: Record<ShowFormKind, string> = {
    concert: 'Support acts',
    theatre: 'Cast',
    comedy: 'Openers / support',
    festival: 'Lineup',
  };

  const isWeb = Platform.OS === 'web';

  return (
    <FormField label={labelByKind[kind]}>
      <View style={styles.listWrap} testID={testID}>
        {rows.length === 0 ? null : isWeb ? (
          rows.map((row) => (
            <React.Fragment key={row.id}>{renderRow(row)}</React.Fragment>
          ))
        ) : (
          <NestableDraggableFlatList<PerformerRow>
            data={rows}
            keyExtractor={(item) => item.id}
            renderItem={({ item, drag, isActive }: RenderItemParams<PerformerRow>) =>
              renderRow(item, { drag, isActive })
            }
            onDragEnd={({ data }) => {
              void hapticSelection();
              onChange(data);
            }}
            activationDistance={8}
          />
        )}

        <Pressable
          onPress={addRow}
          accessibilityRole="button"
          accessibilityLabel={
            kind === 'theatre'
              ? 'Add cast member'
              : kind === 'festival'
                ? 'Add artist to lineup'
                : 'Add support act'
          }
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: colors.rule },
            pressed && { opacity: 0.6 },
          ]}
          testID={testID ? `${testID}-add` : undefined}
        >
          <Plus size={14} color={colors.muted} strokeWidth={2} />
          <Text style={[styles.addBtnText, { color: colors.muted }]}>
            {kind === 'theatre'
              ? 'Add cast member'
              : kind === 'festival'
                ? 'Add artist'
                : 'Add support act'}
          </Text>
          {loading && activeRowId ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : null}
        </Pressable>
      </View>
    </FormField>
  );
}

const styles = StyleSheet.create({
  listWrap: {
    gap: 8,
  },
  rowWrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 6,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dragHandle: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  rowInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  chipThumb: {
    width: 22,
    height: 22,
    borderRadius: RADII.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipName: {
    flex: 1,
    fontFamily: 'Geist Sans 600',
    fontSize: 14,
  },
  chipMeta: {
    fontFamily: 'Geist Sans 600',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tierPillText: {
    fontFamily: 'Geist Sans 700',
    fontSize: 9.5,
    letterSpacing: 0.9,
  },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  characterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 26, // align under the input column (drag handle + small gap)
  },
  characterLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10,
    letterSpacing: 1,
  },
  characterInput: {
    flex: 1,
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: RADII.md,
    paddingVertical: 10,
  },
  addBtnText: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
});
