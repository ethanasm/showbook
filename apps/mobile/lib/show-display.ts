/**
 * Mobile-side display helpers for showing a show's primary label.
 *
 * Mirrors `getHeadliner` from `@showbook/shared` for the flattened
 * `{ name, role, sortOrder }[]` shape used by the Shows / Artists
 * list screens (the nested object graph used by detail screens can
 * call the shared helper directly).
 *
 * Festival and theatre rows with a `productionName` always render
 * the production name — picking a headliner ("The Rapture") in
 * place of the festival ("Portola Music Festival") is the bug this
 * helper exists to prevent.
 */

import { getHeadliner } from '@showbook/shared';

export interface FlatShowPerformer {
  name: string;
  role: 'headliner' | 'support' | 'cast';
  sortOrder: number;
}

export interface HeadlinerDisplayArgs {
  kind: string;
  productionName: string | null;
  performers: FlatShowPerformer[];
  fallback?: string;
}

export function headlinerDisplayName(args: HeadlinerDisplayArgs): string {
  const label = getHeadliner({
    kind: args.kind,
    productionName: args.productionName,
    showPerformers: args.performers.map((p) => ({
      role: p.role,
      sortOrder: p.sortOrder,
      performer: { id: '', name: p.name },
    })),
  });
  if (label && label !== 'Unknown Artist') return label;
  return args.fallback ?? label;
}
