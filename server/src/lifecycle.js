export function deriveTemporalState(event,at=new Date()){
 if(event.status==='Cancelled')return 'CANCELLED';
 const date=String(event.event_date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return 'DATE_UNAVAILABLE';
 const eventDay=new Date(`${date}T00:00:00.000Z`),today=new Date(`${at.toISOString().slice(0,10)}T00:00:00.000Z`),hasStart=/^\d{2}:\d{2}/.test(event.start_time||''),hasEnd=/^\d{2}:\d{2}/.test(event.end_time||''),start=new Date(`${date}T${hasStart?event.start_time.slice(0,5):'00:00'}:00.000Z`),end=new Date(`${date}T${hasEnd?event.end_time.slice(0,5):'23:59'}:59.999Z`);
 if(event.status==='Completed')return eventDay>today?'COMPLETED_DATE_REVIEW':'COMPLETED';
 if(at<start)return event.status==='Planning'?'PLANNING':event.status==='Live'?'UPCOMING_STATUS_REVIEW':'UPCOMING';
 if(at<=end)return event.status==='Live'?'LIVE':'LIVE_STATUS_REVIEW';
 return date<at.toISOString().slice(0,10)?'PAST_STATUS_REVIEW':'EVENT_WINDOW_ENDED_STATUS_REVIEW';
}
