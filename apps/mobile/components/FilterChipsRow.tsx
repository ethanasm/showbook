/**
 * Single-line filter rail with overflow → dropdown.
 *
 * Picks a single id from a flat list. Originally a horizontally
 * scrolling pill rail, this was reworked into a "priority+" pattern:
 * the chips that fit on one line render inline, and the remainder
 * collapse behind a trailing dropdown chip that opens a bottom-sheet
 * picker. Nothing scrolls off the right edge, and the active selection
 * is always pinned visible. Tap the active chip to clear (unless
 * `showAll` is false, in which case the rail is required-selection and
 * tapping the active chip is a no-op).
 *
 * Used by Discover (region + venue rails), the Shows → Stats year
 * picker, and the festival setlist tab.
 */

import React from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Check, ChevronDown, Plus, Search, Trash2, X } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { Sheet } from './Sheet';

export interface FilterGroup {
  id: string;
  name: string;
  sublabel?: string;
  count: number;
  /** Overrides the rendered count with arbitrary text. Used by the
   *  festival setlist tab to show per-artist prediction confidence
   *  ("82%") instead of the numeric song count. */
  badgeText?: string;
}

export interface FilterChipsLeadingAction {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

/** Horizontal gap between inline chips — kept in sync with `styles.row.gap`
 *  so the fit calculation matches the rendered layout. */
const CHIP_GAP = 6;
/** Horizontal padding on the outer `wrap` (kept in sync with
 *  `styles.wrap.paddingHorizontal`). The container's `onLayout` width
 *  includes this padding, but the chip row lives inside it — so the fit
 *  calculation has to subtract both sides or the trailing chip overflows
 *  past the (clipped) right edge. */
const WRAP_H_PADDING = 16;
/** Reserved keys for the non-group chips in the measuring pass. */
const LEAD_KEY = '__lead';
const ALL_KEY = '__all';
const MORE_KEY = '__more';

type ColorTokens = ReturnType<typeof useTheme>['tokens']['colors'];

export function FilterChipsRow({
  groups,
  selected,
  onSelect,
  onLongPress,
  onRemove,
  totalCount,
  allLabel = 'All',
  showAll = true,
  variant = 'primary',
  testIdPrefix,
  leadingAction,
  pickerTitle = 'All filters',
  pickerSearchable = false,
  pickerSearchPlaceholder,
  hideCounts = false,
  hideInlineSublabel = false,
}: {
  groups: FilterGroup[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Long-press a group chip — used by Discover to open the unfollow
   *  confirm sheet. Wired to per-group inline chips only (never "All" or
   *  the leading "+" action). The parent owns the confirm sheet + mutation. */
  onLongPress?: (id: string) => void;
  /** Tap the trash affordance on a row in the overflow dropdown picker.
   *  Fires the removal directly (the trash tap is itself the explicit
   *  intent, so no second confirm sheet) and leaves the picker open so
   *  the row simply vanishes — stacking a confirm `Modal` over the open
   *  picker `Modal` is what crashed the screen. Per-group rows only. */
  onRemove?: (id: string) => void;
  /** Count rendered in the "All" chip; ignored when `showAll` is false. */
  totalCount?: number;
  allLabel?: string;
  /** Render the leading "All" chip. Some surfaces (the festival
   *  setlist tab) default-select an artist and don't want an "All"
   *  option that flattens every lineup setlist into one scroll. */
  showAll?: boolean;
  /** `sub` renders a slightly tighter row used as a second-level filter. */
  variant?: 'primary' | 'sub';
  testIdPrefix?: string;
  /** Action "+" chip rendered at the head of the row so it's visible
   *  without scroll. Suppressed automatically when `variant === 'sub'`. */
  leadingAction?: FilterChipsLeadingAction;
  /** Heading shown above the overflow dropdown picker. */
  pickerTitle?: string;
  /** Render a pinned search field under the picker heading that filters
   *  the rows by name / sublabel. Opt-in (Discover's venue / artist /
   *  region pickers turn it on) so list-y surfaces like the Shows year
   *  picker keep their bare title-then-rows layout. */
  pickerSearchable?: boolean;
  /** Placeholder for the pinned picker search field. */
  pickerSearchPlaceholder?: string;
  /** Suppress the numeric count / badge on the *inline* chips (and the
   *  measuring pass). Used by Discover to keep the rail short so more
   *  followed-entity chips fit on one line. The `count` is still used
   *  for ordering and the fit calculation — only its rendering on the
   *  rail is dropped. The overflow picker sheet always shows the count,
   *  so the per-group metadata stays available one tap away. */
  hideCounts?: boolean;
  /** Suppress the `· sublabel` on the *visible* inline chips (and the
   *  measuring pass) while keeping it in the overflow picker sheet. Used
   *  by Discover so the venue chips read as bare venue names on the rail
   *  but still disambiguate by city in the "All filters" sheet. */
  hideInlineSublabel?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pickerQuery, setPickerQuery] = React.useState('');
  const [availWidth, setAvailWidth] = React.useState<number | null>(null);
  const [widths, setWidths] = React.useState<Record<string, number>>({});

  // Close the picker and clear any in-progress search so the next open
  // starts fresh (and the "All" row reappears).
  const closeSheet = React.useCallback(() => {
    setSheetOpen(false);
    setPickerQuery('');
  }, []);

  const trimmedQuery = pickerQuery.trim().toLowerCase();
  const filteredGroups = React.useMemo(() => {
    if (!pickerSearchable || trimmedQuery === '') return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(trimmedQuery) ||
        (g.sublabel?.toLowerCase().includes(trimmedQuery) ?? false),
    );
  }, [pickerSearchable, trimmedQuery, groups]);

  // Hide the "All" row while the user is actively narrowing the list — a
  // search is for finding a specific entity, not clearing the filter.
  const showAllRow = showAll && trimmedQuery === '';

  const hasLead = Boolean(leadingAction) && variant !== 'sub';

  // Pin the active selection to the front of the group list so it's
  // always among the inline chips (and so picking from the dropdown
  // surfaces the choice without a horizontal hunt).
  const orderedGroups = React.useMemo(() => {
    if (selected === null) return groups;
    const idx = groups.findIndex((g) => g.id === selected);
    if (idx <= 0) return groups;
    const copy = groups.slice();
    const [picked] = copy.splice(idx, 1);
    copy.unshift(picked);
    return copy;
  }, [groups, selected]);

  const { inline, overflow, ready } = React.useMemo(
    () =>
      computeLayout({
        availWidth,
        widths,
        groups: orderedGroups,
        hasLead,
        showAll,
      }),
    [availWidth, widths, orderedGroups, hasLead, showAll],
  );

  const onContainerLayout = React.useCallback((e: LayoutChangeEvent) => {
    // Subtract the wrap's horizontal padding: the chips render inside it,
    // so the usable row width is the measured width minus both sides.
    setAvailWidth(e.nativeEvent.layout.width - WRAP_H_PADDING * 2);
  }, []);

  const captureWidth = React.useCallback((key: string, w: number) => {
    setWidths((prev) =>
      // Avoid an update loop: only store the first non-zero measurement.
      prev[key] === w || w === 0 ? prev : { ...prev, [key]: w },
    );
  }, []);

  const handlePick = React.useCallback(
    (id: string | null) => {
      closeSheet();
      // Tapping the already-active option clears back to "All" when an
      // "All" option exists; otherwise it's a required-selection no-op.
      if (id !== null && id === selected) {
        onSelect(showAll ? null : id);
      } else {
        onSelect(id);
      }
    },
    [closeSheet, onSelect, selected, showAll],
  );

  // The overflow dropdown's trash affordance removes directly and keeps
  // the picker open — the removed row just disappears as the parent's
  // optimistic mutation prunes the group list. We deliberately do NOT
  // dismiss the picker and open a confirm sheet: stacking that second
  // `Modal` over the still-animating picker `Modal` crashed the screen.
  const requestRemove = React.useCallback(
    (id: string) => {
      onRemove?.(id);
    },
    [onRemove],
  );

  return (
    <View
      style={[styles.wrap, variant === 'sub' && styles.wrapSub]}
      onLayout={onContainerLayout}
      testID={testIdPrefix ? `${testIdPrefix}-row` : undefined}
    >
      {/* Off-screen measuring pass: render every possible chip once so
          we know its natural width, then lay out only what fits. */}
      <MeasurePass
        groups={groups}
        colors={colors}
        hasLead={hasLead}
        showAll={showAll}
        allLabel={allLabel}
        totalCount={totalCount ?? 0}
        captureWidth={captureWidth}
        hideCounts={hideCounts}
        hideInlineSublabel={hideInlineSublabel}
      />

      {/* Visible single line. Until the measuring pass lands, every
          group renders inline — keep that pre-layout frame invisible so
          the user never sees chips spill past the edge before they
          collapse behind the dropdown. The chips still lay out, so the
          rail holds its height and there's no vertical jump. */}
      <View style={[styles.row, !ready && styles.rowMeasuring]}>
        {hasLead && leadingAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              leadingAction.accessibilityLabel ?? leadingAction.label
            }
            onPress={leadingAction.onPress}
            testID={leadingAction.testID}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: colors.accentFaded,
                borderColor: 'transparent',
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <LeadingChipBody colors={colors} />
          </Pressable>
        ) : null}

        {showAll ? (
          <Chip
            label={allLabel}
            count={totalCount ?? 0}
            active={selected === null}
            onPress={() => onSelect(null)}
            colors={colors}
            hideCounts={hideCounts}
            testID={testIdPrefix ? `${testIdPrefix}-all` : undefined}
          />
        ) : null}

        {inline.map((g) => (
          <Chip
            key={g.id}
            label={g.name}
            sublabel={g.sublabel}
            count={g.count}
            badgeText={g.badgeText}
            active={selected === g.id}
            onPress={() =>
              onSelect(selected === g.id ? (showAll ? null : g.id) : g.id)
            }
            onLongPress={onLongPress ? () => onLongPress(g.id) : undefined}
            colors={colors}
            hideCounts={hideCounts}
            hideInlineSublabel={hideInlineSublabel}
            testID={testIdPrefix ? `${testIdPrefix}-${g.id}` : undefined}
          />
        ))}

        {overflow.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show ${overflow.length} more ${
              overflow.length === 1 ? 'filter' : 'filters'
            }`}
            onPress={() => setSheetOpen(true)}
            testID={testIdPrefix ? `${testIdPrefix}-more` : undefined}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: colors.surface,
                borderColor: colors.rule,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <MoreChipBody count={overflow.length} colors={colors} />
          </Pressable>
        ) : null}
      </View>

      <Sheet open={sheetOpen} onClose={closeSheet} snapPoints={['60%']}>
        <View style={styles.sheet}>
          <Text style={[styles.sheetTitle, { color: colors.ink }]}>
            {pickerTitle}
          </Text>
          {pickerSearchable ? (
            <View
              style={[
                styles.pickerSearchRow,
                { borderColor: colors.rule, backgroundColor: colors.bg },
              ]}
            >
              <Search size={14} color={colors.muted} strokeWidth={2} />
              <TextInput
                value={pickerQuery}
                onChangeText={setPickerQuery}
                placeholder={pickerSearchPlaceholder ?? 'Search…'}
                placeholderTextColor={colors.faint}
                autoCorrect={false}
                autoCapitalize="none"
                testID={
                  testIdPrefix ? `${testIdPrefix}-sheet-search` : undefined
                }
                style={[styles.pickerSearchInput, { color: colors.ink }]}
                returnKeyType="search"
              />
              {pickerQuery.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setPickerQuery('')}
                  hitSlop={8}
                  testID={
                    testIdPrefix
                      ? `${testIdPrefix}-sheet-search-clear`
                      : undefined
                  }
                  style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                >
                  <X size={14} color={colors.faint} strokeWidth={2} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={styles.sheetList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {showAllRow ? (
              <PickerRow
                label={allLabel}
                count={totalCount ?? 0}
                active={selected === null}
                onPress={() => handlePick(null)}
                colors={colors}
                testID={testIdPrefix ? `${testIdPrefix}-sheet-all` : undefined}
              />
            ) : null}
            {filteredGroups.map((g) => (
              <PickerRow
                key={g.id}
                label={g.name}
                sublabel={g.sublabel}
                count={g.count}
                badgeText={g.badgeText}
                active={selected === g.id}
                onPress={() => handlePick(g.id)}
                onRemove={onRemove ? () => requestRemove(g.id) : undefined}
                colors={colors}
                testID={
                  testIdPrefix ? `${testIdPrefix}-sheet-${g.id}` : undefined
                }
              />
            ))}
            {pickerSearchable && filteredGroups.length === 0 ? (
              <Text
                style={[styles.pickerEmpty, { color: colors.muted }]}
                testID={
                  testIdPrefix ? `${testIdPrefix}-sheet-empty` : undefined
                }
              >
                No matches.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

/** Greedily fit chips on one line; everything else goes to overflow.
 *  Returns all groups inline with `ready: false` until measurements
 *  land — the caller renders that pre-layout pass invisibly (to hold
 *  the rail's height) so the user never sees the un-collapsed row. */
function computeLayout({
  availWidth,
  widths,
  groups,
  hasLead,
  showAll,
}: {
  availWidth: number | null;
  widths: Record<string, number>;
  groups: FilterGroup[];
  hasLead: boolean;
  showAll: boolean;
}): { inline: FilterGroup[]; overflow: FilterGroup[]; ready: boolean } {
  const ready =
    availWidth !== null &&
    (!hasLead || widths[LEAD_KEY] !== undefined) &&
    (!showAll || widths[ALL_KEY] !== undefined) &&
    widths[MORE_KEY] !== undefined &&
    groups.every((g) => widths[g.id] !== undefined);
  if (!ready || availWidth === null) {
    return { inline: groups, overflow: [], ready: false };
  }

  const fixed =
    (hasLead ? widths[LEAD_KEY] + CHIP_GAP : 0) +
    (showAll ? widths[ALL_KEY] + CHIP_GAP : 0);

  // Does the whole set fit without a dropdown?
  const fullWidth =
    fixed + groups.reduce((sum, g) => sum + widths[g.id] + CHIP_GAP, 0);
  if (fullWidth - CHIP_GAP <= availWidth) {
    return { inline: groups, overflow: [], ready: true };
  }

  // Reserve room for the dropdown chip and fill the rest greedily.
  const moreWidth = widths[MORE_KEY] + CHIP_GAP;
  let used = fixed + moreWidth;
  const inline: FilterGroup[] = [];
  const overflow: FilterGroup[] = [];
  for (const g of groups) {
    const w = widths[g.id] + CHIP_GAP;
    if (used + w - CHIP_GAP <= availWidth) {
      inline.push(g);
      used += w;
    } else {
      overflow.push(g);
    }
  }
  if (overflow.length === 0) {
    return { inline: groups, overflow: [], ready: true };
  }
  return { inline, overflow, ready: true };
}

/**
 * Off-screen measuring pass, memoized.
 *
 * It renders one hidden chip per group (plus the lead / all / more
 * chips) purely to capture each natural width. With 150+ followed
 * artists that's 150+ hidden Pressable+Text trees — re-rendering them
 * on every parent tick (ingest polling, watched-set updates) *and* on
 * every `widths` setState from this very pass was the dominant source
 * of Discover's lag. Memoizing on the inputs that actually change the
 * measured geometry (groups / colors / lead+all presence / total-count
 * digit width) decouples it from the parent's frequent re-renders and
 * from the `widths` map it feeds, so the chips are laid out once and
 * left alone. `captureWidth` is a stable `useCallback` from the parent.
 */
const MeasurePass = React.memo(function MeasurePass({
  groups,
  colors,
  hasLead,
  showAll,
  allLabel,
  totalCount,
  captureWidth,
  hideCounts,
  hideInlineSublabel,
}: {
  groups: FilterGroup[];
  colors: ColorTokens;
  hasLead: boolean;
  showAll: boolean;
  allLabel: string;
  totalCount: number;
  captureWidth: (key: string, w: number) => void;
  hideCounts: boolean;
  hideInlineSublabel: boolean;
}): React.JSX.Element {
  return (
    <View
      style={styles.measure}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {hasLead ? (
        <MeasuredChip onWidth={(w) => captureWidth(LEAD_KEY, w)}>
          <LeadingChipBody colors={colors} />
        </MeasuredChip>
      ) : null}
      {showAll ? (
        <MeasuredChip onWidth={(w) => captureWidth(ALL_KEY, w)}>
          <ChipBody
            label={allLabel}
            count={totalCount}
            active={false}
            colors={colors}
            hideCounts={hideCounts}
          />
        </MeasuredChip>
      ) : null}
      {groups.map((g) => (
        <MeasuredChip key={g.id} onWidth={(w) => captureWidth(g.id, w)}>
          <ChipBody
            label={g.name}
            sublabel={g.sublabel}
            count={g.count}
            badgeText={g.badgeText}
            active={false}
            colors={colors}
            hideCounts={hideCounts}
            hideInlineSublabel={hideInlineSublabel}
          />
        </MeasuredChip>
      ))}
      <MeasuredChip onWidth={(w) => captureWidth(MORE_KEY, w)}>
        <MoreChipBody count={groups.length} colors={colors} />
      </MeasuredChip>
    </View>
  );
});

/** Wraps a chip body in an absolutely-positioned measuring host. */
function MeasuredChip({
  children,
  onWidth,
}: {
  children: React.ReactNode;
  onWidth: (w: number) => void;
}): React.JSX.Element {
  return (
    <View
      style={styles.chip}
      onLayout={(e) => onWidth(Math.ceil(e.nativeEvent.layout.width))}
    >
      {children}
    </View>
  );
}

function Chip({
  label,
  sublabel,
  count,
  badgeText,
  active,
  onPress,
  onLongPress,
  colors,
  hideCounts = false,
  hideInlineSublabel = false,
  testID,
}: {
  label: string;
  sublabel?: string;
  count: number;
  badgeText?: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  colors: ColorTokens;
  hideCounts?: boolean;
  hideInlineSublabel?: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${sublabel ? ` ${sublabel}` : ''}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.ink : colors.surface,
          borderColor: active ? colors.ink : colors.rule,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <ChipBody
        label={label}
        sublabel={sublabel}
        count={count}
        badgeText={badgeText}
        active={active}
        colors={colors}
        hideCounts={hideCounts}
        hideInlineSublabel={hideInlineSublabel}
      />
    </Pressable>
  );
}

/** The inner content of a chip — shared by the visible chip and the
 *  off-screen measuring pass so widths line up exactly. */
function ChipBody({
  label,
  sublabel,
  count,
  badgeText,
  active,
  colors,
  hideCounts = false,
  hideInlineSublabel = false,
}: {
  label: string;
  sublabel?: string;
  count: number;
  badgeText?: string;
  active: boolean;
  colors: ColorTokens;
  hideCounts?: boolean;
  hideInlineSublabel?: boolean;
}): React.JSX.Element {
  const renderedBadge =
    hideCounts ? '' : badgeText !== undefined ? badgeText : String(count);
  const showSublabel = Boolean(sublabel) && !hideInlineSublabel;
  return (
    <>
      <Text
        numberOfLines={1}
        style={[
          styles.chipLabel,
          {
            color: active ? colors.bg : colors.ink,
            fontWeight: active ? '600' : '500',
          },
        ]}
      >
        {label}
        {showSublabel ? (
          <Text
            style={[
              styles.chipSublabel,
              { color: active ? colors.bg : colors.muted },
            ]}
          >
            {' '}
            · {sublabel}
          </Text>
        ) : null}
      </Text>
      {renderedBadge.length > 0 ? (
        <Text
          style={[
            styles.chipCount,
            {
              color: active ? colors.bg : colors.faint,
              opacity: active ? 0.7 : 1,
            },
          ]}
        >
          {renderedBadge}
        </Text>
      ) : null}
    </>
  );
}

/** Leading action chip body — a bare "+" glyph. The label is intentionally
 *  dropped from the visible chip (the accessibility label on the parent
 *  Pressable still carries the full "Follow venue" / "Add region" text);
 *  a compact "+" keeps the rail short so a long followed-entity name never
 *  pushes a real chip off the right edge. */
function LeadingChipBody({
  colors,
}: {
  colors: ColorTokens;
}): React.JSX.Element {
  return <Plus size={15} color={colors.accent} strokeWidth={2.5} />;
}

function MoreChipBody({
  count,
  colors,
}: {
  count: number;
  colors: ColorTokens;
}): React.JSX.Element {
  return (
    <>
      <Text style={[styles.chipLabel, { color: colors.ink, fontWeight: '600' }]}>
        {`+${count}`}
      </Text>
      <ChevronDown size={13} color={colors.muted} strokeWidth={2.25} />
    </>
  );
}

function PickerRow({
  label,
  sublabel,
  count,
  badgeText,
  active,
  onPress,
  onRemove,
  colors,
  testID,
}: {
  label: string;
  sublabel?: string;
  count?: number;
  badgeText?: string;
  active: boolean;
  onPress: () => void;
  onRemove?: () => void;
  colors: ColorTokens;
  testID?: string;
}): React.JSX.Element {
  const renderedBadge =
    badgeText !== undefined
      ? badgeText
      : count !== undefined
        ? String(count)
        : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}${sublabel ? ` ${sublabel}` : ''}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.pickerRow,
        {
          backgroundColor: active ? colors.accentFaded : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.pickerCheck}>
        {active ? <Check size={16} color={colors.accent} strokeWidth={2.5} /> : null}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.pickerLabel,
          { color: colors.ink, fontWeight: active ? '600' : '500' },
        ]}
      >
        {label}
        {sublabel ? (
          <Text style={[styles.pickerSublabel, { color: colors.muted }]}>
            {' '}
            · {sublabel}
          </Text>
        ) : null}
      </Text>
      {renderedBadge.length > 0 ? (
        <Text style={[styles.pickerCount, { color: colors.faint }]}>
          {renderedBadge}
        </Text>
      ) : null}
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          onPress={onRemove}
          testID={testID ? `${testID}-remove` : undefined}
          hitSlop={8}
          style={({ pressed }) => [styles.pickerRemove, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Trash2 size={15} color={colors.faint} strokeWidth={2} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
    overflow: 'hidden',
  },
  wrapSub: {
    paddingBottom: 8,
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 16,
    flexDirection: 'row',
    opacity: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CHIP_GAP,
  },
  rowMeasuring: {
    opacity: 0,
    pointerEvents: 'none',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    maxWidth: 220,
  },
  chipLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    letterSpacing: -0.1,
  },
  chipSublabel: {
    fontFamily: 'Geist Sans 400',
    fontSize: 11,
  },
  chipCount: {
    fontFamily: 'Geist Mono 400',
    fontSize: 10,
  },
  sheet: {
    flex: 1,
    paddingHorizontal: 12,
  },
  sheetTitle: {
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 10,
  },
  sheetList: {
    paddingBottom: 24,
  },
  pickerSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADII.lg,
    borderWidth: 1,
  },
  pickerSearchInput: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 14,
    padding: 0,
  },
  pickerEmpty: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: RADII.md,
  },
  pickerCheck: {
    width: 18,
    alignItems: 'center',
  },
  pickerLabel: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 15,
  },
  pickerSublabel: {
    fontFamily: 'Geist Sans 400',
    fontSize: 13,
  },
  pickerCount: {
    fontFamily: 'Geist Mono 400',
    fontSize: 12,
  },
  pickerRemove: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
});
