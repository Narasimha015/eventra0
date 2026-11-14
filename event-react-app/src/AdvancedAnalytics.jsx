import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell, Legend } from 'recharts';
import { Activity, CalendarDays, CheckCircle2, CircleDollarSign, Download, Ticket, TrendingUp, Users } from 'lucide-react';
const Card=({children,className=''})=><section className={`card ${className}`}>{children}</section>;
const Badge=({children,tone='neutral'})=><span className={`badge ${tone}`}>{children}</span>;
export default function AdvancedAnalytics({events,attendees,analytics,onExport,flash}){
  const [range,setRange]=useState('Portfolio');
  const allEvents=events||[]; const safeAttendees=attendees||[];
  const safeEvents=range==='Upcoming'?allEvents.filter(e=>['Planning','Upcoming'].includes(e.status)):range==='Live'?allEvents.filter(e=>e.status==='Live'):allEvents;
  const totalRegs=range==='Portfolio'&&analytics?Number(analytics.totalRegistrations||0):safeEvents.reduce((s,e)=>s+Number(e.registrations||0),0);
  const totalCap=range==='Portfolio'&&analytics?Number(analytics.totalCapacity||0):safeEvents.reduce((s,e)=>s+Number(e.capacity||0),0);
  const revenue=range==='Portfolio'&&analytics?Number(analytics.totalRevenue||0):safeEvents.reduce((s,e)=>s+Number(e.revenue||0),0);
  const checked=range==='Portfolio'&&analytics?Number(analytics.checkedIn||0):safeAttendees.filter(a=>a.status==='Checked In').length;
  const utilization=totalCap?Math.round(totalRegs/totalCap*1000)/10:0;
  const attendance=totalRegs?Math.round(checked/totalRegs*1000)/10:0;
  const avg=totalRegs?Math.round(revenue/totalRegs):0;
  const completion=safeEvents.length?Math.round(safeEvents.filter(e=>e.status==='Completed').length/safeEvents.length*100):0;
  const eventPerformance=safeEvents.map(e=>({name:e.name.length>18?e.name.slice(0,18)+'…':e.name,registrations:Number(e.registrations||0),capacity:Number(e.capacity||0),revenue:Number(e.revenue||0),utilization:e.capacity?Math.round(e.registrations/e.capacity*100):0})).sort((a,b)=>b.registrations-a.registrations);
  const ticketData=Object.entries(safeAttendees.reduce((m,a)=>{const k=a.ticket||'General Access';m[k]=(m[k]||0)+1;return m},{})).map(([name,value])=>({name,value}));
  const statusData=Object.entries(safeEvents.reduce((m,e)=>{m[e.status]=(m[e.status]||0)+1;return m},{})).map(([name,value])=>({name,value}));
  const monthMap={}; safeEvents.forEach(e=>{const d=new Date(e.date);const key=Number.isNaN(d.getTime())?'Unscheduled':d.toLocaleString('en-IN',{month:'short',year:'2-digit'});monthMap[key]=(monthMap[key]||0)+Number(e.registrations||0)});
  const trendData=range==='Portfolio'&&analytics?.registrationTrends?.length?analytics.registrationTrends.map(item=>({month:item.month,registrations:Number(item.registrations||0)})):Object.entries(monthMap).map(([month,registrations])=>({month,registrations}));
  const top=eventPerformance[0]; const risk=eventPerformance.find(e=>e.utilization>=90)||eventPerformance[eventPerformance.length-1];
  const insights=[
    {label:'Demand leader',value:top?.name||'No events',detail:top?`${top.registrations.toLocaleString()} registrations`: 'Create an event to generate insights',tone:'positive'},
    {label:'Capacity watch',value:risk?.name||'Portfolio stable',detail:risk&&risk.utilization>=90?`${risk.utilization}% utilized — review remaining inventory`:'No event is above the 90% capacity watchline',tone:risk&&risk.utilization>=90?'warning':'positive'},
    {label:'Attendance signal',value:`${attendance}%`,detail:attendance>=70?'Healthy check-in conversion':'Improve reminders and gate operations',tone:attendance>=70?'positive':'warning'},
    {label:'Revenue efficiency',value:`₹${avg.toLocaleString()}`,detail:'Average recorded revenue per registration',tone:'neutral'}
  ];
  const exportReport=()=>{
    const rows=safeEvents.map(e=>[e.name,e.date,e.status,e.registrations,e.capacity,e.capacity?Math.round(e.registrations/e.capacity*100):0,e.revenue,e.registrations?Math.round(e.revenue/e.registrations):0]);
    onExport(['Event','Date','Status','Registrations','Capacity','Utilization %','Revenue','Revenue / Registration'],rows);
    flash('Advanced analytics report exported.');
  };
  return <section className="advanced-analytics">
    <div className="analytics-hero"><div><div className="eyebrow"><TrendingUp size={14}/> EVENTRA PERFORMANCE INTELLIGENCE</div><h2>Know what is working. Act before it becomes a problem.</h2><p>A decision-ready view of demand, attendance, capacity and revenue across your event portfolio.</p></div><div className="analytics-hero-actions"><Badge tone="success"><span className="live-dot"/> Current portfolio</Badge><button className="secondary" onClick={exportReport}><Download size={15}/> Export report</button></div></div>
    <div className="analytics-toolbar"><div><b>Performance window</b><span>Calculated from current workspace records</span></div><div className="range-toggle">{['Portfolio','Upcoming','Live'].map(x=><button key={x} className={range===x?'selected':''} onClick={()=>setRange(x)}>{x}</button>)}</div></div>
    <div className="analytics-kpis">
      {[["Portfolio revenue",`₹${revenue.toLocaleString()}`,'Recorded across events',CircleDollarSign],['Registration volume',totalRegs.toLocaleString(),`${utilization}% of available capacity`,Users],['Attendance conversion',`${attendance}%`,`${checked.toLocaleString()} check-ins recorded`,CheckCircle2],['Event completion',`${completion}%`,`${safeEvents.filter(e=>e.status==='Completed').length} completed events`,CalendarDays]].map(([label,value,detail,Icon])=><Card className="analytics-kpi" key={label}><div className="analytics-kpi-icon"><Icon size={18}/></div><span>{label}</span><strong>{value}</strong><small>{detail}</small></Card>)}
    </div>
    <div className="analytics-grid-two"><Card className="chart-card analytics-large"><div className="section-head"><div><h2>Registration activity</h2><p>{range==='Portfolio'&&analytics?.registrationTrends?.length?'Confirmed registrations by creation month':'Portfolio registrations grouped by event date'}</p></div><Badge tone="purple">Server data</Badge></div><div className="chart tall">{trendData.length?<ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData}><defs><linearGradient id="analyticsDemand" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6558db" stopOpacity={0.3}/><stop offset="100%" stopColor="#6558db" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Area type="monotone" dataKey="registrations" stroke="#6558db" fill="url(#analyticsDemand)" strokeWidth={2.5}/></AreaChart></ResponsiveContainer>:<div className="empty-state"><TrendingUp size={24}/><b>No registration trend yet</b><span>Trend data appears as registrations are recorded.</span></div>}</div></Card>
      <Card className="chart-card"><div className="section-head"><div><h2>Ticket mix</h2><p>Recorded attendee distribution</p></div><Ticket size={18}/></div><div className="chart pie-chart">{ticketData.length?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={ticketData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>{ticketData.map((_,i)=><Cell key={i} fill={['#6458d6','#16866f','#e49a46','#4385c2','#bf6288'][i%5]}/>)}</Pie><Tooltip/><Legend verticalAlign="bottom" height={36}/></PieChart></ResponsiveContainer>:<div className="empty-state"><Ticket size={24}/><b>No ticket data</b><span>Ticket categories appear after registrations.</span></div>}</div></Card>
    </div>
    <div className="analytics-grid-two"><Card className="chart-card analytics-large"><div className="section-head"><div><h2>Event performance matrix</h2><p>Registration demand versus available capacity</p></div><Badge tone="success">Utilization</Badge></div><div className="chart tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={eventPerformance}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="registrations" name="Registrations" radius={[6,6,0,0]}/><Bar dataKey="capacity" name="Capacity" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></div></Card>
      <Card><div className="section-head"><div><h2>Event lifecycle</h2><p>Portfolio distribution by status</p></div><Activity size={18}/></div><div className="lifecycle-list">{statusData.map(item=><div className="lifecycle-row" key={item.name}><div><b>{item.name}</b><span>{item.value} event{item.value===1?'':'s'}</span></div><strong>{safeEvents.length?Math.round(item.value/safeEvents.length*100):0}%</strong></div>)}{!statusData.length&&<div className="empty-state"><CalendarDays size={25}/><b>No lifecycle data</b></div>}</div></Card>
    </div>
    <div className="insight-grid"><div className="section-head full-width"><div><h2>Executive insights</h2><p>Signals worth acting on before your next operating review.</p></div><Badge tone="purple">Decision support</Badge></div>{insights.map(item=><div className={`insight-card ${item.tone}`} key={item.label}><span>{item.label}</span><b>{item.value}</b><p>{item.detail}</p></div>)}</div>
    <Card><div className="section-head"><div><h2>Portfolio leaderboard</h2><p>Ranked by registration volume and utilization</p></div><Badge tone="neutral">Top {Math.min(5,eventPerformance.length)}</Badge></div><div className="leaderboard">{eventPerformance.slice(0,5).map((e,i)=><div className="leader-row" key={e.name}><div className="rank">{String(i+1).padStart(2,'0')}</div><div className="leader-main"><b>{e.name}</b><div className="mini-progress"><i style={{width:`${Math.min(100,e.utilization)}%`}}/></div></div><span>{e.registrations.toLocaleString()} regs</span><strong>{e.utilization}%</strong><span>₹{e.revenue.toLocaleString()}</span></div>)}{!eventPerformance.length&&<div className="empty-state"><TrendingUp size={25}/><b>No events available</b></div>}</div></Card>
  </section>
}


