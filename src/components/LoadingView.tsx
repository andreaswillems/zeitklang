import styles from "./LoadingView.module.css";

/**
 * Inhalt des Ladezustands (#8, Parity web/index.html L60–63): Spinner +
 * Text. Die Sektions-Hülle (id="loading", role="status", hidden-Switch
 * auf view()) bleibt in app.tsx (3a).
 */
export function LoadingView() {
  return (
    <>
      <div class={styles.spinner} aria-hidden="true" />
      <p>Anmeldung läuft…</p>
    </>
  );
}
