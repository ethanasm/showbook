/**
 * Action sheet shown when an upcoming-announcement row is tapped on the
 * venue detail and Discover screens. Replaces the previous stacked
 * "WATCH" / "GOT TICKET" icon buttons on each row — those affordances
 * read as ambiguous on a list, and the icons-with-tiny-caps treatment
 * doubled the row height. Tap-to-open keeps the row dense and gives
 * the actions room to wear longer, plain-language labels.
 *
 * The sheet is intentionally callback-driven: parents already own the
 * watch toggle (`useToggleWatch`) and the navigate-to-add-form path
 * (Discover may need to detour through `PickPerformanceDateSheet` for
 * multi-night runs first), so this component only renders the menu
 * and dismisses itself after firing each action.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkCheck, BookmarkPlus, Ticket } from 'lucide-react-native';

import { Sheet } from './Sheet';
import { TicketmasterMark } from './BrandIcons';
import { useTheme } from '@/lib/theme';
import { useFeedback } from '@/lib/feedback';
import { hapticSelection } from '@/lib/haptics';

export interface UpcomingAnnouncementActionSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * When false, the watch action is hidden (e.g. non-watchable kinds
   * like generic-event). The caller already gates the row's tap
   * affordance, but the sheet defends in depth.
   */
  canWatch: boolean;
  isWatching: boolean;
  /** Ticket URL — when null, the "Buy tickets" row is omitted. */
  ticketUrl: string | null | undefined;
  /** Toggle the announcement's watch state. Caller wraps the hook. */
  onToggleWatch: () => void;
  /** Open the Add Show form pre-filled with this announcement. */
  onMarkTicketed: () => void;
}

export function UpcomingAnnouncementActionSheet({
  open,
  onClose,
  canWatch,
  isWatching,
  ticketUrl,
  onToggleWatch,
  onMarkTicketed,
}: UpcomingAnnouncementActionSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { showToast } = useFeedback();

  const handleToggleWatch = (): void => {
    void hapticSelection();
    onClose();
    onToggleWatch();
  };

  const handleMarkTicketed = (): void => {
    void hapticSelection();
    onClose();
    onMarkTicketed();
  };

  const handleOpenTickets = (): void => {
    if (!ticketUrl) return;
    void hapticSelection();
    onClose();
    Linking.openURL(ticketUrl).catch(() => {
      showToast({ kind: 'error', text: "Couldn't open Ticketmaster." });
    });
  };

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['32%']}>
      <View style={styles.body}>
        {canWatch ? (
          <ActionRow
            icon={
              isWatching ? (
                <BookmarkCheck size={20} color={colors.ink} strokeWidth={2} />
              ) : (
                <BookmarkPlus size={20} color={colors.ink} strokeWidth={2} />
              )
            }
            label={isWatching ? 'Remove from watchlist' : 'Save to watchlist'}
            onPress={handleToggleWatch}
            testID="announcement-action-watch"
          />
        ) : null}
        <ActionRow
          icon={<Ticket size={20} color={colors.ink} strokeWidth={2} />}
          label="Mark as ticketed"
          onPress={handleMarkTicketed}
          testID="announcement-action-ticketed"
        />
        {ticketUrl ? (
          <ActionRow
            icon={<TicketmasterMark size={20} />}
            label="Buy tickets on Ticketmaster"
            onPress={handleOpenTickets}
            testID="announcement-action-buy-tickets"
          />
        ) : null}
      </View>
    </Sheet>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.rule },
        pressed && { backgroundColor: colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.iconSlot}>{icon}</View>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconSlot: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '500',
  },
});
