// Max content width for the full-page list tables (Artists, Venues).
// On displays wider than this the list left-anchors to the
// page padding (the sidebar already biases the content towards the
// right edge), keeping the inter-column whitespace reasonable. Passed
// to PaginationFooter's `maxWidth` so the sticky footer stays aligned
// with the capped table. Mobile layouts skip the cap entirely.
export const LIST_MAX_WIDTH = 1080;
