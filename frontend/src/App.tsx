import { NavLink, Route, Routes } from 'react-router-dom'
import { ConnectionChip } from './components/ConnectionChip'
import { BenchPage } from './pages/BenchPage'
import { ComparePage } from './pages/ComparePage'
import { PlayPage } from './pages/PlayPage'
import { SettingsPage } from './pages/SettingsPage'

const NAV = [
  { to: '/play', label: 'Play' },
  { to: '/compare', label: 'Compare' },
  { to: '/bench', label: 'Bench' },
  { to: '/settings', label: 'Settings' },
]

export default function App() {
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">◎</span>
          <span>HVS-3B Search Studio</span>
        </div>
        <ConnectionChip />
      </header>
      <div className="app__body">
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav__link is-active' : 'nav__link'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main id="main" className="app__main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<PlayPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/bench" element={<BenchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<PlayPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
