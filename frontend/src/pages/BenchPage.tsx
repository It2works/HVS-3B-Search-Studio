export function BenchPage() {
  return (
    <section className="page">
      <header className="page__head">
        <div>
          <h1>Bench</h1>
          <p className="page__lede">Batch success rates across tasks and difficulties.</p>
        </div>
      </header>
      <div className="state-panel">
        <p>Benchmark endpoints are not implemented in the current API build.</p>
        <p className="state-panel__hint">
          The contract reserves <code>/api/bench/*</code>; no results are shown until those
          routes exist.
        </p>
      </div>
    </section>
  )
}
