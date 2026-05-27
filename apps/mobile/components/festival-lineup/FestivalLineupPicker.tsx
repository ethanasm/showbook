/**
 * FestivalLineupPicker (mobile) — list of extracted artists with
 * checkboxes, tier toggles, drag-to-reorder handles, an inline
 * name-edit search (so OCR mistakes can be fixed), and a filter
 * input. Mirrors the web `apps/web/components/add/FestivalLineupPicker.tsx`.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, GripVertical, Pencil, Search, X } from 'lucide-react-native';
import DraggableFlatListImport, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { RemoteImage } from '../design-system';
import { trpc } from '@/lib/trpc';
import { useDebouncedValue } from '@showbook/shared/hooks';
import type {
  FestivalArtistTier,
  FestivalLineupFlow,
  FestivalLineupRow,
  FestivalLineupTmMatch,
} from '@/lib/festival-lineup/useFestivalLineup';

// Standalone draggable list (manages its own scrolling). We use this
// rather than `NestableDraggableFlatList` because the picker is the
// only scroll region on the screen — the nestable variant defers
// scrolling to a parent `NestableScrollContainer` that doesn't exist
// here, which left the last rows trapped under the sticky footer.
// CJS interop matches the pattern in `LineupEditor.tsx`.
const DraggableFlatList =
  (DraggableFlatListImport as unknown as {
    default?: typeof DraggableFlatListImport;
  }).default ?? DraggableFlatListImport;

interface FestivalLineupPickerProps {
  flow: FestivalLineupFlow;
}

export function FestivalLineupPicker({ flow }: FestivalLineupPickerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const trimmed = query.trim().toLowerCase();
  const filtering = trimmed.length > 0;

  const filtered = useMemo(() => {
    if (!filtering) return flow.rows;
    return flow.rows.filter((r) => r.name.toLowerCase().includes(trimmed));
  }, [flow.rows, filtering, trimmed]);

  const isWeb = Platform.OS === 'web';

  const renderRow = (
    row: FestivalLineupRow,
    params: { drag?: () => void; isActive?: boolean } = {},
  ): React.JSX.Element => {
    const isEditing = editingId === row.id;
    return (
      <LineupRow
        row={row}
        checked={flow.selected.has(row.id)}
        tier={flow.tierFor(row)}
        onToggle={() => flow.toggle(row.id)}
        onSetTier={(t) => flow.setTier(row.id, t)}
        editing={isEditing}
        onStartEdit={() => setEditingId(row.id)}
        onCancelEdit={() => setEditingId(null)}
        onPickArtist={(name, tmMatch) => {
          flow.setRowName(row.id, name, tmMatch ?? null);
          setEditingId(null);
        }}
        drag={params.drag}
        isActive={!!params.isActive}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Filter row */}
      <View style={[styles.filterRow, { borderBottomColor: colors.rule }]}>
        <Search size={14} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter artists…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.filterInput, { color: colors.ink }]}
        />
        {query ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear filter"
          >
            <X size={14} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      {/* Stats bar */}
      <View
        style={[
          styles.statsBar,
          { borderBottomColor: colors.rule, backgroundColor: colors.surfaceRaised },
        ]}
      >
        <View style={styles.statsInner}>
          <Stat value={flow.counts.headliners} label="headliners" emphasize />
          <Sep />
          <Stat value={flow.counts.support} label="support" />
          <Sep />
          <Stat value={flow.counts.unselected} label="not selected" faint />
          {flow.isMatching ? (
            <>
              <Sep />
              <Text style={[styles.statsHint, { color: colors.faint }]}>matching…</Text>
            </>
          ) : null}
        </View>
        {flow.rows.length > 0 ? (
          <View style={styles.bulkActions}>
            {flow.selected.size < flow.rows.length ? (
              <Pressable
                onPress={flow.selectAll}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Select all artists"
              >
                <Text style={[styles.selectAll, { color: colors.muted }]}>
                  Select all
                </Text>
              </Pressable>
            ) : null}
            {flow.selected.size > 0 && flow.selected.size < flow.rows.length ? (
              <Text style={[styles.selectAll, { color: colors.faint }]}>·</Text>
            ) : null}
            {flow.selected.size > 0 ? (
              <Pressable
                onPress={flow.deselectAll}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Deselect all artists"
              >
                <Text style={[styles.selectAll, { color: colors.muted }]}>
                  Deselect all
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* List */}
      {filtered.length === 0 ? (
        <View style={styles.list}>
          <Text style={[styles.empty, { color: colors.muted }]}>
            {filtering
              ? 'No artists match your filter.'
              : "Couldn't read a lineup. Try another image or add the artists manually."}
          </Text>
        </View>
      ) : filtering || isWeb ? (
        // While filtering we render the static (non-draggable) view so
        // dragging a filtered row doesn't reorder the underlying array
        // in a confusing way. We also fall back to static on web —
        // react-native-draggable-flatlist isn't reliable there.
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {filtered.map((row) => (
            <React.Fragment key={row.id}>{renderRow(row)}</React.Fragment>
          ))}
        </ScrollView>
      ) : (
        <DraggableFlatList<FestivalLineupRow>
          data={flow.rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item, drag, isActive }: RenderItemParams<FestivalLineupRow>) =>
            renderRow(item, { drag, isActive })
          }
          onDragEnd={({ data }) => flow.reorder(data)}
          activationDistance={8}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

function LineupRow({
  row,
  checked,
  tier,
  onToggle,
  onSetTier,
  editing,
  onStartEdit,
  onCancelEdit,
  onPickArtist,
  drag,
  isActive,
}: {
  row: FestivalLineupRow;
  checked: boolean;
  tier: FestivalArtistTier;
  onToggle: () => void;
  onSetTier: (tier: FestivalArtistTier) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onPickArtist: (name: string, tmMatch: FestivalLineupTmMatch | null) => void;
  drag?: () => void;
  isActive?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <View
      style={[
        styles.rowWrap,
        {
          borderBottomColor: colors.rule,
          opacity: isActive ? 0.85 : 1,
          backgroundColor: isActive ? colors.surfaceRaised : 'transparent',
        },
      ]}
    >
      <Pressable
        onPress={editing ? undefined : onToggle}
        style={({ pressed }) => [
          styles.row,
          { opacity: pressed && !editing ? 0.7 : checked ? 1 : 0.55 },
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={row.name}
        disabled={editing}
      >
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
        <Checkbox checked={checked} />
        <RemoteImage
          uri={row.tmMatch?.imageUrl}
          name={row.name}
          kind="concert"
          size="custom"
          width={36}
          height={36}
          style={styles.thumb}
        />
        <View style={styles.body}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.tmMatch === null ? (
            <Text style={[styles.sub, { color: colors.faint }]}>no tm match</Text>
          ) : null}
        </View>
        <Pressable
          onPress={editing ? onCancelEdit : onStartEdit}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Cancel edit' : `Edit ${row.name}`}
          style={({ pressed }) => [
            styles.editBtn,
            { borderColor: colors.rule },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Pencil size={11} color={colors.muted} strokeWidth={2} />
          <Text style={[styles.editLabel, { color: colors.muted }]}>
            {editing ? 'CLOSE' : 'EDIT'}
          </Text>
        </Pressable>
        <TierToggle tier={tier} disabled={!checked} onChange={onSetTier} />
      </Pressable>
      {editing ? (
        <ArtistSearchInline
          initialQuery={row.name}
          onPick={onPickArtist}
          onCancel={onCancelEdit}
        />
      ) : null}
    </View>
  );
}

function ArtistSearchInline({
  initialQuery,
  onPick,
  onCancel,
}: {
  initialQuery: string;
  onPick: (name: string, tmMatch: FestivalLineupTmMatch | null) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebouncedValue(query, 250);
  const enabled = debounced.trim().length >= 2;

  const localQuery = trpc.performers.search.useQuery(
    { query: debounced },
    { enabled, staleTime: 60_000 },
  );
  const tmQuery = trpc.performers.searchExternal.useQuery(
    { query: debounced },
    { enabled, staleTime: 60_000 },
  );

  type Suggestion = {
    key: string;
    name: string;
    imageUrl: string | null;
    tmAttractionId: string | null;
    musicbrainzId: string | null;
    source: 'local' | 'tm';
  };
  const suggestions: Suggestion[] = useMemo(() => {
    if (!enabled) return [];
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const dedupKey = (name: string, tmId?: string | null) =>
      `${(tmId ?? '').toLowerCase()}|${name.toLowerCase()}`;
    for (const l of localQuery.data ?? []) {
      const key = dedupKey(l.name, l.ticketmasterAttractionId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `local:${l.id}`,
        name: l.name,
        imageUrl: l.imageUrl ?? null,
        tmAttractionId: l.ticketmasterAttractionId ?? null,
        musicbrainzId: l.musicbrainzId ?? null,
        source: 'local',
      });
    }
    for (const t of tmQuery.data ?? []) {
      const key = dedupKey(t.name, t.tmAttractionId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `tm:${t.tmAttractionId}`,
        name: t.name,
        imageUrl: t.imageUrl ?? null,
        tmAttractionId: t.tmAttractionId,
        musicbrainzId: t.musicbrainzId,
        source: 'tm',
      });
    }
    return out.slice(0, 8);
  }, [enabled, localQuery.data, tmQuery.data]);

  const loading = localQuery.isFetching || tmQuery.isFetching;

  const pickSuggestion = (s: Suggestion) => {
    const tmMatch: FestivalLineupTmMatch | null = s.tmAttractionId
      ? {
          tmAttractionId: s.tmAttractionId,
          name: s.name,
          imageUrl: s.imageUrl,
          musicbrainzId: s.musicbrainzId,
        }
      : null;
    onPick(s.name, tmMatch);
  };

  return (
    <View style={[styles.searchPanel, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
      <View style={[styles.searchPanelInputRow, { borderBottomColor: colors.rule }]}>
        <Search size={12} color={colors.muted} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search artist name…"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
          autoCapitalize="words"
          style={[styles.searchPanelInput, { color: colors.ink }]}
          returnKeyType="search"
          onSubmitEditing={() => {
            const first = suggestions[0];
            if (first) pickSuggestion(first);
            else if (query.trim()) onPick(query.trim(), null);
          }}
        />
        {query.trim().length > 0 ? (
          <Pressable
            onPress={() => onPick(query.trim(), null)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Use typed name as-is"
            style={({ pressed }) => [
              styles.useTypedBtn,
              { borderColor: colors.rule },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.useTypedLabel, { color: colors.muted }]} numberOfLines={1}>
              USE TYPED
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onCancel}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}
        >
          <X size={12} color={colors.muted} strokeWidth={2} />
        </Pressable>
      </View>
      <View style={styles.searchResults}>
        {!enabled ? (
          <Text style={[styles.searchHint, { color: colors.muted }]}>
            Type at least 2 characters…
          </Text>
        ) : loading && suggestions.length === 0 ? (
          <View style={styles.searchLoading}>
            <ActivityIndicator size="small" color={colors.muted} />
            <Text style={[styles.searchHint, { color: colors.muted }]}>Searching…</Text>
          </View>
        ) : suggestions.length === 0 ? (
          <Text style={[styles.searchHint, { color: colors.muted }]}>
            No matches. Tap Return to keep the typed name.
          </Text>
        ) : (
          suggestions.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => pickSuggestion(s)}
              style={({ pressed }) => [
                styles.searchResultRow,
                { borderTopColor: colors.rule },
                pressed && { backgroundColor: colors.surfaceRaised },
              ]}
            >
              {s.imageUrl ? (
                <Image
                  source={{ uri: s.imageUrl }}
                  style={[styles.searchResultThumb, { borderColor: colors.rule }]}
                />
              ) : (
                <View
                  style={[
                    styles.searchResultThumbPlaceholder,
                    { borderColor: colors.rule, backgroundColor: colors.surfaceRaised },
                  ]}
                />
              )}
              <Text style={[styles.searchResultName, { color: colors.ink }]} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={[styles.searchResultSource, { color: colors.faint }]}>
                {s.source === 'tm' ? 'TM' : 'LIBRARY'}
              </Text>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

function TierToggle({
  tier,
  disabled,
  onChange,
}: {
  tier: FestivalArtistTier;
  disabled?: boolean;
  onChange: (tier: FestivalArtistTier) => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[styles.tierToggle, { borderColor: colors.ruleStrong, opacity: disabled ? 0.4 : 1 }]}
    >
      <TierButton
        active={tier === 'headliner'}
        disabled={disabled}
        onPress={() => onChange('headliner')}
        label="Headliner"
      />
      <View style={[styles.tierDivider, { backgroundColor: colors.ruleStrong }]} />
      <TierButton
        active={tier === 'support'}
        disabled={disabled}
        onPress={() => onChange('support')}
        label="Support"
      />
    </View>
  );
}

function TierButton({
  active,
  disabled,
  onPress,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  label: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={[
        styles.tierBtn,
        { backgroundColor: active ? colors.accent : 'transparent' },
      ]}
    >
      <Text
        style={[
          styles.tierLabel,
          { color: active ? colors.accentText : colors.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Checkbox({ checked }: { checked: boolean }): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View
      style={[
        styles.checkbox,
        {
          borderColor: checked ? colors.accent : colors.ruleStrong,
          backgroundColor: checked ? colors.accent : 'transparent',
        },
      ]}
    >
      {checked ? <Check size={12} color={colors.accentText} strokeWidth={3} /> : null}
    </View>
  );
}

function Stat({
  value,
  label,
  emphasize,
  faint,
}: {
  value: number;
  label: string;
  emphasize?: boolean;
  faint?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const valueColor = emphasize ? colors.accent : faint ? colors.faint : colors.ink;
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: valueColor }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.faint }]}>{label}</Text>
    </View>
  );
}

function Sep(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return <Text style={{ color: colors.faint }}>·</Text>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 14,
    paddingVertical: 0,
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  statsInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statsHint: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.5,
  },
  selectAll: {
    fontFamily: 'Geist Mono 500',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bulkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statValue: {
    fontFamily: 'Geist Mono 600',
    fontSize: 12,
  },
  statLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 12,
  },
  empty: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 28,
  },
  rowWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dragHandle: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: RADII.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    borderRadius: RADII.sm,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
    letterSpacing: -0.1,
  },
  sub: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.sm,
    paddingHorizontal: 5,
    paddingVertical: 4,
  },
  editLabel: {
    fontFamily: 'Geist Mono 600',
    fontSize: 9,
    letterSpacing: 0.8,
  },
  tierToggle: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.sm,
    overflow: 'hidden',
  },
  tierDivider: {
    width: StyleSheet.hairlineWidth,
  },
  tierBtn: {
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tierLabel: {
    fontFamily: 'Geist Mono 600',
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  searchPanel: {
    marginHorizontal: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  searchPanelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchPanelInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
    paddingVertical: 0,
  },
  useTypedBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.sm,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  useTypedLabel: {
    fontFamily: 'Geist Mono 600',
    fontSize: 9,
    letterSpacing: 0.7,
  },
  cancelBtn: {
    padding: 4,
  },
  searchResults: {
    maxHeight: 240,
  },
  searchHint: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  searchResultThumb: {
    width: 26,
    height: 26,
    borderRadius: RADII.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchResultThumbPlaceholder: {
    width: 26,
    height: 26,
    borderRadius: RADII.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchResultName: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
  },
  searchResultSource: {
    fontFamily: 'Geist Mono',
    fontSize: 9,
    letterSpacing: 0.8,
  },
});
