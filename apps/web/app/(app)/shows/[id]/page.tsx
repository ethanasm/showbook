"use client";

import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { ShowDetailTabsView } from "@/components/show-tabs";
import { CenteredMessage } from "@/components/design-system";

export default function ShowDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const showId = params?.id ?? "";

  const detailQuery = trpc.shows.detail.useQuery(
    { showId },
    { enabled: Boolean(showId) },
  );

  if (detailQuery.isLoading) {
    return <CenteredMessage>Loading show…</CenteredMessage>;
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <CenteredMessage tone="error">
        Couldn&apos;t load show.{" "}
        <button
          type="button"
          onClick={() => router.push("/logbook")}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
            padding: 0,
            marginLeft: 8,
          }}
        >
          back to shows →
        </button>
      </CenteredMessage>
    );
  }

  const show = detailQuery.data;

  return <ShowDetailTabsView show={show as Parameters<typeof ShowDetailTabsView>[0]["show"]} />;
}
