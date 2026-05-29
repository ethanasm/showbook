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
  View,
} from 'react-native';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react-native';
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
  totalCount,
  allLabel = 'All',
  showAll = true,
  variant = 'primary',
  testIdPrefix,
  leadingAction,
  pickerTitle = 'All filters',
}: {
  groups: FilterGroup[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Long-press a group chip (or tap its trash affordance in the overflow
   *  dropdown picker) — used by Discover to open the unfollow action
   *  sheet. Wired to per-group entries only (never "All" or the leading
   *  "+" action). The parent owns the confirm sheet + mutation. */
  onLongPress?: (id: string) => void;
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
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [availWidth, setAvailWidth] = React.useState<number | null>(null);
  const [widths, setWidths] = React.useState<Record<string, number>>({});

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

  const { inline, overflow } = React.useMemo(
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
    setAvailWidth(e.nativeEvent.layout.width);
  }, []);

  const captureWidth = React.useCallback((key: string, w: number) => {
    setWidths((prev) =>
      // Avoid an update loop: only store the first non-zero measurement.
      prev[key] === w || w === 0 ? prev : { ...prev, [key]: w },
    );
  }, []);

  const handlePick = React.useCallback(
    (id: string | null) => {
      setSheetOpen(false);
      // Tapping the already-active option clears back to "All" when an
      // "All" option exists; otherwise it's a required-selection no-op.
      if (id !== null && id === selected) {
        onSelect(showAll ? null : id);
      } else {
        onSelect(id);
      }
    },
    [onSelect, selected, showAll],
  );

  // The overflow dropdown's trash affordance routes through the same
  // parent long-press handler the inline chips use. Close the picker
  // first so the parent's confirm sheet isn't stacked on top of it.
  const requestRemove = React.useCallback(
    (id: string) => {
      setSheetOpen(false);
      onLongPress?.(id);
    },
    [onLongPress],
  );

  return (
    <View
      style={[styles.wrap, variant === 'sub' && styles.wrapSub]}
      onLayout={onContainerLayout}
      testID={testIdPrefix ? `${testIdPrefix}-row` : undefined}
    >
      {/* Off-screen measuring pass: render every possible chip once so
          we know its natural width, then lay out only what fits. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {hasLead && leadingAction ? (
          <MeasuredChip onWidth={(w) => captureWidth(LEAD_KEY, w)}>
            <LeadingChipBody label={leadingAction.label} colors={colors} />
          </MeasuredChip>
        ) : null}
        {showAll ? (
          <MeasuredChip onWidth={(w) => captureWidth(ALL_KEY, w)}>
            <ChipBody
              label={allLabel}
              count={totalCount ?? 0}
              active={false}
              colors={colors}
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
            />
          </MeasuredChip>
        ))}
        <MeasuredChip onWidth={(w) => captureWidth(MORE_KEY, w)}>
          <MoreChipBody count={groups.length} colors={colors} />
        </MeasuredChip>
      </View>

      {/* Visible single line. */}
      <View style={styles.row}>
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
            <LeadingChipBody label={leadingAction.label} colors={colors} />
          </Pressable>
        ) : null}

        {showAll ? (
          <Chip
            label={allLabel}
            count={totalCount ?? 0}
            active={selected === null}
            onPress={() => onSelect(null)}
            colors={colors}
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

      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} snapPoints={['60%']}>
        <View style={styles.sheet}>
          <Text style={[styles.sheetTitle, { color: colors.ink }]}>
            {pickerTitle}
          </Text>
          <ScrollView
            contentContainerStyle={styles.sheetList}
            showsVerticalScrollIndicator={false}
          >
            {showAll ? (
              <PickerRow
                label={allLabel}
                count={totalCount ?? 0}
                active={selected === null}
                onPress={() => handlePick(null)}
                colors={colors}
                testID={testIdPrefix ? `${testIdPrefix}-sheet-all` : undefined}
              />
            ) : null}
            {groups.map((g) => (
              <PickerRow
                key={g.id}
                label={g.name}
                sublabel={g.sublabel}
                count={g.count}
                badgeText={g.badgeText}
                active={selected === g.id}
                onPress={() => handlePick(g.id)}
                onRemove={onLongPress ? () => requestRemove(g.id) : undefined}
                colors={colors}
                testID={
                  testIdPrefix ? `${testIdPrefix}-sheet-${g.id}` : undefined
                }
              />
            ))}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

/** Greedily fit chips on one line; everything else goes to overflow.
 *  Returns all groups inline (no overflow) until measurements land, so
 *  the first paint shows the real chips (clipped) rather than a flash
 *  of the dropdown. */
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
}): { inline: FilterGroup[]; overflow: FilterGroup[] } {
  const ready =
    availWidth !== null &&
    (!hasLead || widths[LEAD_KEY] !== undefined) &&
    (!showAll || widths[ALL_KEY] !== undefined) &&
    widths[MORE_KEY] !== undefined &&
    groups.every((g) => widths[g.id] !== undefined);
  if (!ready || availWidth === null) {
    return { inline: groups, overflow: [] };
  }

  const fixed =
    (hasLead ? widths[LEAD_KEY] + CHIP_GAP : 0) +
    (showAll ? widths[ALL_KEY] + CHIP_GAP : 0);

  // Does the whole set fit without a dropdown?
  const fullWidth =
    fixed + groups.reduce((sum, g) => sum + widths[g.id] + CHIP_GAP, 0);
  if (fullWidth - CHIP_GAP <= availWidth) {
    return { inline: groups, overflow: [] };
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
  if (overflow.length === 0) return { inline: groups, overflow: [] };
  return { inline, overflow };
}

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
}: {
  label: string;
  sublabel?: string;
  count: number;
  badgeText?: string;
  active: boolean;
  colors: ColorTokens;
}): React.JSX.Element {
  const renderedBadge = badgeText !== undefined ? badgeText : String(count);
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
        {sublabel ? (
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

function LeadingChipBody({
  label,
  colors,
}: {
  label: string;
  colors: ColorTokens;
}): React.JSX.Element {
  return (
    <>
      <Plus size={12} color={colors.accent} strokeWidth={2.5} />
      <Text
        numberOfLines={1}
        style={[styles.chipLabel, { color: colors.accent, fontWeight: '600' }]}
      >
        {label}
      </Text>
    </>
  );
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
    badgeText !== undefined ? badgeText : count !== undefined ? String(count) : '';
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
