export function ComparePage() {
  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1>Compare</h1>
          <p className="page__lede">Run the same instruction through two models side by side.</p>
        </div>
      </header>
      <div className="state-panel">
        <p>Comparison is not available in this prototype.</p>
        <p className="state-panel__hint">
          Start a single run on the Play page. Benchmark and comparison endpoints are not
          part of the current API.
        </p>
      </div>
    </section>
  )
}
