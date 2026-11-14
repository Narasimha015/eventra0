import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function OverviewPerformanceChart({events,attendees}){
  const data=events.map(event=>({name:event.name,registrations:Number(event.registrations||0),checkedIn:attendees.filter(attendee=>attendee.event===event.name&&attendee.status==='Checked In').length}));
  if(!data.length)return <div className="chart-placeholder">No event data to chart yet.</div>;
  return <ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="registrations" name="Registrations" fill="#6657e8" radius={[5,5,0,0]}/><Bar dataKey="checkedIn" name="Checked in" fill="#39aa85" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>
}
