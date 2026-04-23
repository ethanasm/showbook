"use client";

import "./design-system.css";

interface SegmentedControlProps {
  options: string[];
  selected: string;
  onChange: (value: string) => void;
}

export function SegmentedControl({
  options,
  selected,
  onChange,
}: SegmentedControlProps) {
  return (
    <div className="segmented-control">
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
        >
          {option}
        </button>
      ))}
    </div>
  );
}
