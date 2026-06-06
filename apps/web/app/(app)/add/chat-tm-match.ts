// The chat-add "did you mean one of these?" date gate + Ticketmaster
// search window now live in `@showbook/shared` so the mobile chat-add
// flow can share the exact same logic. Re-exported here to keep the
// existing web import path (and its unit test) stable.
export { isUpcomingDateHint, tmDateWindow } from '@showbook/shared';
