"use client";

import { Music } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SpotifyImportPicker } from "./SpotifyImportPicker";
import { useSpotifyImport } from "./useSpotifyImport";

const mono = "var(--font-geist-mono)";

export function SpotifyImport() {
  const flow = useSpotifyImport();
  const utils = trpc.useUtils();
  const connection = trpc.spotify.connectionStatus.useQuery();
  const disconnect = trpc.spotify.disconnect.useMutation({
    onSuccess: () => {
      utils.spotify.connectionStatus.invalidate();
      flow.reset();
    },
  });

  // ────── Picking / importing — render the picker inline ──────
  if (flow.phase === "picking" || flow.phase === "importing" || flow.phase === "loading") {
    return (
      <div style={pickerCardStyle}>
        <SpotifyImportPicker flow={flow} />
      </div>
    );
  }

  const isConnected = connection.data?.connected === true;
  const displayName = isConnected ? connection.data?.displayName ?? null : null;

  // ────── Empty / connect / done state ──────
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "14px 0",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              letterSpacing: -0.15,
            }}
          >
            Spotify
          </div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: isConnected ? "var(--accent)" : "var(--muted)",
              marginTop: 3,
              letterSpacing: ".04em",
            }}
          >
            {isConnected
              ? displayName
                ? `connected as ${displayName}`
                : "connected"
              : "import the artists you follow on Spotify"}
          </div>
          {flow.importedCount !== null && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: "var(--accent)",
                marginTop: 6,
                letterSpacing: ".04em",
              }}
            >
              Imported {flow.importedCount} artist{flow.importedCount === 1 ? "" : "s"}.
            </div>
          )}
          {(flow.error || disconnect.error) && (
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: "#E63946",
                marginTop: 6,
                letterSpacing: ".04em",
              }}
            >
              {flow.error ?? disconnect.error?.message}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={flow.loadArtists}
                style={connectButtonStyle}
              >
                <Music size={12} />
                <span>Show artists</span>
              </button>
              <button
                type="button"
                onClick={() => disconnect.mutate({ reason: "user_disconnect" })}
                disabled={disconnect.isPending}
                style={disconnectButtonStyle}
              >
                {disconnect.isPending ? "..." : "Disconnect"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={flow.startConnect}
              style={connectButtonStyle}
            >
              <Music size={12} />
              <span>Connect Spotify</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  padding: "4px 20px 4px",
  marginBottom: 36,
};

const pickerCardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  marginBottom: 36,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const connectButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontFamily: mono,
  fontSize: 10.5,
  fontWeight: 500,
  color: "var(--ink)",
  background: "transparent",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  padding: "6px 12px",
  cursor: "pointer",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  flexShrink: 0,
};

const disconnectButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "1px solid var(--rule-strong)",
  borderRadius: 0,
  padding: "5px 10px",
  cursor: "pointer",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  flexShrink: 0,
};
