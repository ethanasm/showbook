"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Music, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";

type ListedArtist = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  tmMatch: { tmAttractionId: string; name: string; imageUrl: string | null } | null;
  alreadyFollowed: boolean;
};

const mono = "var(--font-geist-mono)";

export function SpotifyImport() {
  const utils = trpc.useUtils();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artists, setArtists] = useState<ListedArtist[] | null>(null);
  const [meta, setMeta] = useState<{ total: number; resolved: number; truncated: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const handlerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const listFollowed = trpc.spotifyImport.listFollowed.useMutation({
    onSuccess: (data) => {
      setArtists(data.artists);
      setMeta({
        total: data.totalCount,
        resolved: data.resolvedCount,
        truncated: data.truncated,
      });
      // Default-select every artist that has a TM match and isn't
      // already followed.
      setSelected(
        new Set(
          data.artists
            .filter((a) => a.tmMatch && !a.alreadyFollowed)
            .map((a) => a.spotifyId),
        ),
      );
    },
    onError: (err) => {
      setError(err.message);
      setAccessToken(null);
    },
  });

  const importSelected = trpc.spotifyImport.importSelected.useMutation({
    onSuccess: (data) => {
      setImportedCount(data.imported.length);
      setArtists(null);
      setSelected(new Set());
      setAccessToken(null);
      // Refresh artist rails / followed lists
      utils.performers.followed.invalidate();
      utils.performers.list.invalidate();
      utils.performers.count.invalidate();
      utils.discover.followedFeed.invalidate();
    },
    onError: (err) => setError(err.message),
  });

  // Cleanup the message listener on unmount
  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener("message", handlerRef.current);
        handlerRef.current = null;
      }
    };
  }, []);

  const startConnect = useCallback(() => {
    setError(null);
    setImportedCount(null);

    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "spotify-auth" && e.data.accessToken) {
        window.removeEventListener("message", handler);
        handlerRef.current = null;
        setAccessToken(e.data.accessToken);
        listFollowed.mutate({ accessToken: e.data.accessToken });
      }
      if (e.data?.type === "spotify-auth-error") {
        window.removeEventListener("message", handler);
        handlerRef.current = null;
        setError("Spotify authorization failed");
      }
    };
    handlerRef.current = handler;
    window.addEventListener("message", handler);

    const popup = window.open(
      "/api/spotify",
      "spotify-auth",
      "width=500,height=700,popup=yes",
    );
    if (popup) {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (handlerRef.current) {
            window.removeEventListener("message", handlerRef.current);
            handlerRef.current = null;
          }
        }
      }, 500);
    }
  }, [listFollowed]);

  const toggle = useCallback((spotifyId: string, importable: boolean) => {
    if (!importable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(spotifyId)) {
        next.delete(spotifyId);
      } else {
        next.add(spotifyId);
      }
      return next;
    });
  }, []);

  const submitImport = useCallback(() => {
    if (!artists) return;
    const byId = new Map(artists.map((a) => [a.spotifyId, a]));
    const payload = Array.from(selected)
      .map((id) => byId.get(id))
      .filter((a): a is ListedArtist => Boolean(a?.tmMatch))
      .map((a) => ({
        tmAttractionId: a.tmMatch!.tmAttractionId,
        name: a.tmMatch!.name,
        imageUrl: a.tmMatch!.imageUrl ?? undefined,
      }));
    if (payload.length === 0) return;
    importSelected.mutate({ artists: payload });
  }, [artists, selected, importSelected]);

  const stats = useMemo(() => {
    if (!artists) return null;
    const matchable = artists.filter((a) => a.tmMatch && !a.alreadyFollowed);
    const alreadyFollowed = artists.filter((a) => a.alreadyFollowed);
    const noMatch = artists.filter((a) => !a.tmMatch);
    return {
      matchable: matchable.length,
      alreadyFollowed: alreadyFollowed.length,
      noMatch: noMatch.length,
    };
  }, [artists]);

  // ────── Empty / connect state ──────
  if (!accessToken && !artists) {
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
                color: "var(--muted)",
                marginTop: 3,
                letterSpacing: ".04em",
              }}
            >
              import the artists you follow on Spotify
            </div>
            {importedCount !== null && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: "var(--accent)",
                  marginTop: 6,
                  letterSpacing: ".04em",
                }}
              >
                Imported {importedCount} artist{importedCount === 1 ? "" : "s"}.
              </div>
            )}
            {error && (
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: "#E63946",
                  marginTop: 6,
                  letterSpacing: ".04em",
                }}
              >
                {error}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={startConnect}
            style={connectButtonStyle}
          >
            <Music size={12} />
            <span>Connect Spotify</span>
          </button>
        </div>
      </div>
    );
  }

  // ────── Loading state (token in hand, waiting on listFollowed) ──────
  if (listFollowed.isPending || !artists) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: "20px 0", textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: "var(--muted)", letterSpacing: ".04em" }}>
            Loading your Spotify followed artists…
          </div>
        </div>
      </div>
    );
  }

  // ────── Picker state ──────
  return (
    <div style={cardStyle}>
      <div
        style={{
          padding: "14px 0",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontFamily: "var(--font-geist-sans)", fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: -0.15 }}>
            Pick artists to import
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", marginTop: 3, letterSpacing: ".04em" }}>
            {stats?.matchable ?? 0} importable · {stats?.alreadyFollowed ?? 0} already followed · {stats?.noMatch ?? 0} no Ticketmaster match
            {meta?.truncated ? ` · showing first ${meta.resolved} of ${meta.total}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setArtists(null);
            setAccessToken(null);
            setSelected(new Set());
          }}
          style={cancelButtonStyle}
        >
          Cancel
        </button>
      </div>

      <div style={{ maxHeight: 360, overflow: "auto", padding: "4px 0" }}>
        {artists.map((artist) => {
          const importable = Boolean(artist.tmMatch) && !artist.alreadyFollowed;
          const isSelected = selected.has(artist.spotifyId);
          const status = artist.alreadyFollowed
            ? "already followed"
            : artist.tmMatch
              ? null
              : "no events on Ticketmaster";

          return (
            <div
              key={artist.spotifyId}
              onClick={() => toggle(artist.spotifyId, importable)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 4px",
                borderBottom: "1px solid var(--rule)",
                cursor: importable ? "pointer" : "not-allowed",
                opacity: importable ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "1.5px solid",
                  borderColor:
                    artist.alreadyFollowed
                      ? "var(--accent)"
                      : isSelected && importable
                        ? "var(--accent)"
                        : "var(--rule-strong)",
                  background:
                    artist.alreadyFollowed
                      ? "var(--accent)"
                      : isSelected && importable
                        ? "var(--accent)"
                        : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {(artist.alreadyFollowed || (isSelected && importable)) && (
                  <Check size={11} color="var(--accent-text)" strokeWidth={3} />
                )}
              </div>
              {artist.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.imageUrl}
                  alt=""
                  width={32}
                  height={32}
                  style={{ width: 32, height: 32, objectFit: "cover", flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: "var(--surface2)",
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans)",
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: "var(--ink)",
                    letterSpacing: -0.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {artist.name}
                </div>
                {status && (
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: "var(--faint)",
                      marginTop: 2,
                      letterSpacing: ".04em",
                    }}
                  >
                    {status}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "#E63946",
            padding: "8px 0",
            letterSpacing: ".04em",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          padding: "14px 0 4px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".04em" }}>
          {selected.size} selected
        </div>
        <button
          type="button"
          onClick={submitImport}
          disabled={selected.size === 0 || importSelected.isPending}
          style={{
            ...importButtonStyle,
            opacity: selected.size === 0 || importSelected.isPending ? 0.4 : 1,
            cursor: selected.size === 0 || importSelected.isPending ? "not-allowed" : "pointer",
          }}
        >
          {importSelected.isPending
            ? "Importing…"
            : `Import ${selected.size} artist${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  padding: "4px 20px 4px",
  marginBottom: 36,
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

const cancelButtonStyle: React.CSSProperties = {
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

const importButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "8px 16px",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  transition: "opacity 0.15s ease",
};
