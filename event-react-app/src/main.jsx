import { Component, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShieldCheck, Zap, AlertTriangle, RefreshCw } from 'lucide-react';
import './index.css';
import './App.css';
import App from './App.jsx';
import PublicLanding from './PublicLanding.jsx';
import { api } from './api.js';

class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) { console.error('Eventra UI error:', error); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return <div className="fatal-screen"><div className="fatal-card"><div className="fatal-icon"><AlertTriangle size={22}/></div><div className="eyebrow">EVENTRA RECOVERY</div><h1>We hit an unexpected screen error.</h1><p>Your workspace data is stored separately. Refresh the application to recover the interface.</p><button className="primary" onClick={()=>window.location.reload()}><RefreshCw size={16}/> Reload Eventra</button></div></div>;
  }
}

export function AuthGate() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [creatingAccount,setCreatingAccount]=useState(()=>window.location.pathname==='/register');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const logout=useCallback(async()=>{try{await api('/auth/logout',{method:'POST',body:{}})}catch(error){console.error('Server logout failed:',error)}setSession(null)},[]);
  useEffect(()=>{api('/auth/me').then(result=>setSession({user:result.user})).catch(()=>{setSession(null)}).finally(()=>setCheckingSession(false));},[]);
  const login = async (event) => {
    event.preventDefault(); setLoading(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const path=creatingAccount?'/auth/register':'/auth/login';
      const next = await api(path,{method:'POST',body:{...(creatingAccount?{name:String(form.get('name')).trim()}:{}),email:String(form.get('email')).trim(),password:String(form.get('password'))}});
      const role=next.user.role;const destination=role==='ATTENDEE'?'/dashboard':role==='ADMIN'?'/admin':'/organizer';window.history.replaceState({},'',destination);setSession({user:next.user});
    } catch (reason) { setError(reason.message || 'Unable to sign in. Make sure the Eventra API is running.'); }
    finally { setLoading(false); }
  };
  if(checkingSession)return <div className="auth-screen"><section className="auth-card"><span className="auth-kicker">EVENTRA OPERATIONS PLATFORM</span><h1>Checking your session…</h1></section></div>;
  if (session) {const role=session.user.role,defaultPath=role==='ATTENDEE'?'/dashboard':role==='ADMIN'?'/admin':'/organizer';if(window.location.pathname==='/'||window.location.pathname==='/login'||window.location.pathname==='/register')window.history.replaceState({},'',defaultPath);return <App session={session} onLogout={logout}/>}
  if(!['/login','/register'].includes(window.location.pathname))return <PublicLanding/>;
  return <div className="auth-screen"><section className="auth-card"><a className="auth-back" href="/">← Back to events</a><div className="auth-brand"><Zap size={19}/></div><span className="auth-kicker">EVENTRA · {creatingAccount?'ATTENDEE ACCOUNT':'EVENT OPERATIONS'}</span><h1>{creatingAccount?'Create your attendee account':'Welcome back.'}</h1><p>{creatingAccount?'Discover upcoming events and keep your tickets in one place.':'Sign in to manage your events, registrations, or tickets.'}</p><form onSubmit={login}>{creatingAccount&&<label>Full name<input name="name" required maxLength="120" autoComplete="name"/></label>}<label>Email address<input name="email" required type="email" autoComplete="username"/></label><label>Password<input name="password" required minLength={creatingAccount?12:1} type="password" autoComplete={creatingAccount?'new-password':'current-password'}/>{creatingAccount&&<small>Use at least 12 characters.</small>}</label>{error&&<div className="auth-error" role="alert"><AlertTriangle size={15}/>{error}</div>}<button className="primary full" disabled={loading}>{loading?(creatingAccount?'Creating account…':'Signing in…'):creatingAccount?'Create attendee account':'Sign in'}</button></form><a className="text-btn auth-switch" href={creatingAccount?'/login':'/register'} onClick={e=>{e.preventDefault();const next=creatingAccount?'/login':'/register';window.history.pushState({},'',next);setCreatingAccount(!creatingAccount);setError('')}}>{creatingAccount?'Already have an account? Sign in':'New to Eventra? Create an account'}</a><div className="demo-note"><ShieldCheck size={14}/><span>Development demo accounts are listed in the project README.</span></div></section><aside className="auth-aside"><div><span>EVENTRA · EVENT OPERATIONS</span><h2>Thoughtful planning.<br/>Memorable experiences.</h2><p>Discover events, coordinate the details, and welcome attendees with confidence.</p></div><div className="auth-points"><div><b>Secure</b><small>HTTP-only sessions</small></div><div><b>Connected</b><small>Live platform data</small></div><div><b>Eventra</b><small>One shared workspace</small></div></div></aside></div>;
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><AuthGate /></ErrorBoundary>);
