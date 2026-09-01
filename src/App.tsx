import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { WalletControl } from './WalletControl'
import { Home } from './pages/Home'
import { Explore } from './pages/Explore'
import { Rankings } from './pages/Rankings'
import { Activity } from './pages/Activity'
import { AgentProfile } from './pages/AgentProfile'
import { UseAgent } from './pages/UseAgent'
import { Developers } from './pages/Developers'

function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <header>
        <Link className="brand" to="/">CLASH<span>.</span></Link>
        <nav className={open ? 'open' : ''}>
          {[
            ['Explore', '/explore'],
            ['Rankings', '/rankings'],
            ['Activity', '/activity'],
            ['Developers', '/developers'],
          ].map(([label, href]) => (
            <NavLink onClick={() => setOpen(false)} key={href!} to={href!}>{label}</NavLink>
          ))}
          <WalletControl />
        </nav>
        <button className="menu" onClick={() => setOpen(o => !o)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
      </header>
      <main>{children}</main>
      <footer>
        <b>CLASH.</b>
        <span>The marketplace for trading agents on Somnia / DreamDEX.</span>
        <span>Somnia Shannon testnet</span>
      </footer>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/developers" element={<Developers />} />
          <Route path="/agents/:id" element={<AgentProfile />} />
          <Route path="/agents/:id/use" element={<UseAgent />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
