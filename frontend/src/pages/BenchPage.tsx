export function BenchPage() {
  return (
    <section className="page">
      <header className="page__head">
        <p className="eyebrow">Bench</p>
        <h1>Success rates, across the set.</h1>
        <p className="page__lede">Batch results are not available in this build.</p>
      </header>
      <div className="state-panel">
        <p>The contract reserves <code>/api/bench/*</code>; no results until those routes exist.</p>
      </div>
    </section>
  )
}
