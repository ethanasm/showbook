"use client";

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        padding: 2,
        transition: "background 0.15s ease",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        background: checked ? "var(--accent)" : "rgba(128,128,128,.3)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        style={{
          display: "block",
          width: 16,
          height: 16,
          borderRadius: 8,
          transition: "all 0.15s ease",
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          background: checked ? "var(--accent-text)" : "rgba(255,255,255,.7)",
        }}
      />
    </button>
  );
}
