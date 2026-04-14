import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Spinner } from "./Spinner";
import { VisuallyHidden } from "./VisuallyHidden";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  hideLabel?: boolean;
  showCounter?: boolean;
  loading?: boolean;
  containerClassName?: string;
  controlClassName?: string;
}

export function TextField({
  id,
  label,
  hint,
  error,
  startAdornment,
  endAdornment,
  hideLabel = false,
  showCounter = false,
  loading = false,
  className = "",
  containerClassName = "",
  controlClassName = "",
  value,
  required,
  disabled,
  maxLength,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id || `ui-field-${generatedId}`;
  const hintId = useId();
  const errorId = useId();
  const counterId = useId();

  const stringValue = typeof value === "string" ? value : "";
  const showCharacterCounter = showCounter && typeof maxLength === "number";

  const describedBy = [
    hint ? hintId : null,
    error ? errorId : null,
    showCharacterCounter ? counterId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={["ui-text-field", containerClassName].filter(Boolean).join(" ")}>
      {hideLabel ? (
        <VisuallyHidden>
          <label htmlFor={fieldId}>{label}</label>
        </VisuallyHidden>
      ) : (
        <label htmlFor={fieldId} className="ui-text-field__label">
          {label}
          {required ? <span className="ui-text-field__required">*</span> : null}
        </label>
      )}

      <div
        className={[
          "ui-text-field__control",
          error ? "ui-text-field__control--invalid" : "",
          disabled ? "ui-text-field__control--disabled" : "",
          controlClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {startAdornment ? <span aria-hidden="true">{startAdornment}</span> : null}
        <input
          id={fieldId}
          className={["ui-text-field-input", className].filter(Boolean).join(" ")}
          required={required}
          disabled={disabled || loading}
          value={value}
          maxLength={maxLength}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy || undefined}
          {...rest}
        />
        {loading ? <Spinner size="sm" label="Carregando campo" /> : endAdornment || null}
      </div>

      <div className="ui-text-field__meta">
        {error ? (
          <p id={errorId} className="ui-text-field__error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="ui-text-field__hint">
            {hint}
          </p>
        ) : (
          <span />
        )}

        {showCharacterCounter ? (
          <p id={counterId} className="ui-text-field__counter" aria-live="polite">
            {stringValue.length}/{maxLength}
          </p>
        ) : null}
      </div>
    </div>
  );
}
