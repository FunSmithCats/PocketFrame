import { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

export function Toggle({ checked, onChange, label, id: providedId }: ToggleProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;

  return (
    <label htmlFor={id} className="flex items-center cursor-pointer">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`
          w-9 h-5 rounded-full relative transition-colors overflow-hidden flex-shrink-0
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900
          ${checked ? 'bg-gb-light' : 'bg-neutral-700'}
        `}
      >
        <span
          aria-hidden="true"
          className={`
            absolute left-0 top-0.5 w-4 h-4 bg-white rounded-full transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}
          `}
        />
      </button>
      <span className="ml-2 text-sm">{label}</span>
    </label>
  );
}
