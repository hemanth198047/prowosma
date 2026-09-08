// A plain, dependency-free fallback UI — deliberately not fancy, since
// this only renders when something has already gone wrong at the React
// render level and the LAST thing that path should depend on is more
// application code that could itself fail.
export function ErrorFallback({ error }) {
  return (
    <div style={{ padding: "40px", fontFamily: "sans-serif", textAlign: "center" }}>
      <h2>Something went wrong.</h2>
      <p style={{ color: "#666" }}>
        The error has been reported automatically. Try reloading the page.
      </p>
      {import.meta.env.DEV && (
        <pre style={{ textAlign: "left", background: "#f5f5f5", padding: "12px", marginTop: "16px", overflow: "auto" }}>
          {String(error)}
        </pre>
      )}
    </div>
  )
}
