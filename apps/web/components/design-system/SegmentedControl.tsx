"use client";

import "./design-system.css";

interface SegmentedControlProps {
  options: string[];
  selected: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}

export function SegmentedControl({
  options,
  selected,
  onChange,
  ariaLabel,
}: SegmentedControlProps) {
  return (
    <div
      className="segmented-control"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option}
          className={`segmented-control__option ${
            option === selected
              ? "segmented-control__option--active"
              : "segmented-control__option--inactive"
          }`}
          onClick={() => onChange(option)}
          type="button"
          aria-pressed={option === selected}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
