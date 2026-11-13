import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string; onValue: (value: string) => void; onGesture: (active: boolean) => void; multiline?: boolean;
};

/** Native DOM owns preedit/selection; Drei renders this in a separate React root. */
export function ScheduleTextField({ value, onValue, onGesture, multiline, ...props }: Props) {
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const latest = useRef({ onValue, onGesture });
  latest.current = { onValue, onGesture };
  useLayoutEffect(() => {
    const field = input.current;
    if (field && document.activeElement !== field && !composing.current && field.value !== value) field.value = value;
  }, [value]);
  const shared = {
    ...props, ref: input, defaultValue: value, spellCheck: false, autoComplete: 'off',
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => {
      // Escape cancels an IME candidate, not the world interaction.
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Escape') event.stopPropagation();
    },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false; latest.current.onValue(event.currentTarget.value);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) latest.current.onValue(event.currentTarget.value);
    },
    onFocus: () => latest.current.onGesture(true),
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!composing.current) latest.current.onValue(event.currentTarget.value);
      latest.current.onGesture(false);
    },
  };
  return multiline ? <textarea {...shared as React.TextareaHTMLAttributes<HTMLTextAreaElement>} ref={input} rows={2} /> : <input {...shared} />;
}
