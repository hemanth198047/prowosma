import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

// Can this browser draw a normal text box as dots? (Chrome, Edge, Safari: yes.)
const CAN_MASK = typeof CSS !== "undefined" && typeof CSS.supports === "function"
  && (CSS.supports("-webkit-text-security", "disc") || CSS.supports("text-security", "disc"));

/**
 * A box for an API key or token: hidden as dots, with Show / Hide.
 *
 * Deliberately NOT <input type="password"> where the browser can mask a text box: a password field makes
 * browsers offer to fill in (or save) the person's Prowosma sign-in password here, and makes tools that
 * scan the app treat the page as a login page (AI Settings was reported as "redirected to a login page").
 * Where masking isn't available it falls back to a password field, so the key is never shown by accident.
 */
export default function SecretInput({ id, value, onChange, placeholder, className = "", style, disabled, ...rest }) {
  const [shown, setShown] = useState(false);
  const masked = !shown;
  return (
    <span className={`secret-input-wrap ${className}`.trim()} style={style}>
      <input
        id={id}
        type={masked && !CAN_MASK ? "password" : "text"}
        className={"secret-input" + (masked ? " secret-input--masked" : "")}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        {...rest}
      />
      <button
        type="button"
        className="secret-input-toggle"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? "Hide key" : "Show key"}
        title={shown ? "Hide" : "Show"}
        disabled={disabled}
      >
        {shown ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
      </button>
    </span>
  );
}
